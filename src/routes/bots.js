'use strict';
// إنشاء/تعديل/حذف السيرفرات + التشغيل والإيقاف + بيانات الدخول + اللوجات
const crypto = require('crypto');
const fs = require('fs-extra');
const state = require('../state');
const { safeRouter, isSafeRelativePath, sanitizeEnv } = require('../utils');
const { decryptPw } = require('../auth');
const { loadBots, withDb } = require('../store');
const { findAccessibleBot } = require('../middleware');
const { upload, storeUpload } = require('../uploads');
const { createServerAccess, removeServerAccessForBots } = require('../accounts');
const {
  getBotPath, getBotStatus, getBotLogs, startBot, stopBot, forceStopBot,
} = require('../botManager');

const router = safeRouter();

const ownerMap = () => new Map(state.users.map(u => [u.id, u.username]));

// Get all bots (own or all for admins)
router.get('/api/bots', async (req, res) => {
  const bots = await loadBots();
  let visible;
  if (req.user.role === 'admin') visible = bots;
  else if (req.user.role === 'server') visible = bots.filter(b => b.id === req.user.botId);
  else visible = bots.filter(b => b.ownerId === req.user.id);
  const owners = ownerMap();
  const enriched = visible.map(b => ({
    ...b,
    status: getBotStatus(b.id),
    ownerName: owners.get(b.ownerId) || '—',
  }));
  res.json(enriched);
});

// Get single bot
router.get('/api/bots/:id', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  const owners = ownerMap();
  res.json({ ...found.bot, status: getBotStatus(found.bot.id), ownerName: owners.get(found.bot.ownerId) || '—' });
});

// Create bot (upload file)
router.post('/api/bots', upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  try {
    const { name, mainFile, description, env } = req.body || {};

    if (req.user.role === 'server') {
      if (uploaded) await fs.remove(uploaded.path).catch(() => {});
      return res.status(403).json({ success: false, error: 'حساب السيرفر مش مسموح له بإنشاء سيرفرات' });
    }

    const botName = String(name || '').trim().slice(0, 64) || 'Untitled Server';
    const botMainFile = String(mainFile || '').trim() || 'index.js';
    if (!isSafeRelativePath(botMainFile)) {
      if (uploaded) await fs.remove(uploaded.path).catch(() => {});
      return res.status(400).json({ success: false, error: 'الملف الرئيسي غير صالح' });
    }

    if (req.user.role !== 'admin') {
      const limit = req.user.maxBots || 0;
      if (limit > 0) {
        const count = (await loadBots()).filter(b => b.ownerId === req.user.id).length;
        if (count >= limit) {
          if (uploaded) await fs.remove(uploaded.path).catch(() => {});
          return res.status(403).json({ success: false, error: `وصلت للحد الأقصى المسموح لك (${limit} سيرفر)` });
        }
      }
    }

    let envObj = {};
    if (env) {
      try {
        envObj = sanitizeEnv(JSON.parse(env));
      } catch (_) {
        if (uploaded) await fs.remove(uploaded.path).catch(() => {});
        return res.status(400).json({ success: false, error: 'متغيرات البيئة ليست JSON صالح' });
      }
    }

    const id = crypto.randomUUID();
    const botPath = getBotPath(id);
    await fs.ensureDir(botPath);

    if (uploaded) {
      const stored = await storeUpload(botPath, null, uploaded);
      if (stored.error) {
        await fs.remove(botPath).catch(() => {}); // ما نسيبش مجلد فاضي لسيرفر ما اتسجلش
        return res.status(400).json({ success: false, error: stored.error });
      }
    }

    const bot = {
      id,
      ownerId: req.user.id,
      name: botName,
      mainFile: botMainFile,
      description: String(description || '').slice(0, 500),
      env: envObj,
      autoRestart: true,
      createdAt: Date.now(),
    };

    await withDb(bots => { bots.push(bot); });

    let credentials = null;
    try {
      credentials = await createServerAccess(bot.id);
    } catch (err) {
      console.error('Create server access error:', err);
    }

    res.json({ success: true, bot, credentials });
  } catch (err) {
    console.error('Create bot error:', err);
    if (uploaded) await fs.remove(uploaded.path).catch(() => {});
    res.status(500).json({ success: false, error: 'فشل إنشاء السيرفر' });
  }
});

// Update bot (whitelisted fields only)
router.put('/api/bots/:id', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ error: found.error });

    const body = req.body || {};
    const patch = {};

    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 64);
    if (typeof body.description === 'string') patch.description = body.description.slice(0, 500);
    if (typeof body.mainFile === 'string' && body.mainFile.trim()) {
      if (!isSafeRelativePath(body.mainFile.trim())) {
        return res.status(400).json({ success: false, error: 'الملف الرئيسي غير صالح' });
      }
      patch.mainFile = body.mainFile.trim();
    }
    if (body.env !== undefined) {
      if (typeof body.env !== 'object' || body.env === null || Array.isArray(body.env)) {
        return res.status(400).json({ success: false, error: 'متغيرات البيئة غير صالحة' });
      }
      patch.env = sanitizeEnv(body.env);
    }
    if (typeof body.autoRestart === 'boolean') patch.autoRestart = body.autoRestart;

    const updated = await withDb(bots => {
      const idx = bots.findIndex(b => b.id === found.bot.id);
      if (idx === -1) return null;
      bots[idx] = { ...bots[idx], ...patch };
      return bots[idx];
    });

    if (!updated) return res.status(404).json({ error: 'Bot not found' });
    res.json({ success: true, bot: updated });
  } catch (err) {
    console.error('Update bot error:', err);
    res.status(500).json({ success: false, error: 'فشل تحديث السيرفر' });
  }
});

// Delete bot
router.delete('/api/bots/:id', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ error: found.error });

    await forceStopBot(found.bot.id);
    await withDb(bots => {
      const idx = bots.findIndex(b => b.id === found.bot.id);
      if (idx !== -1) bots.splice(idx, 1);
    });
    await removeServerAccessForBots([found.bot.id]);
    await fs.remove(getBotPath(found.bot.id));
    res.json({ success: true });
  } catch (err) {
    console.error('Delete bot error:', err);
    res.status(500).json({ success: false, error: 'فشل حذف السيرفر' });
  }
});

// Start bot
router.post('/api/bots/:id/start', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  const result = await startBot(found.bot);
  res.json(result);
});

// Stop bot
router.post('/api/bots/:id/stop', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  res.json(stopBot(found.bot.id));
});

// Kill bot (force)
router.post('/api/bots/:id/kill', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  await forceStopBot(found.bot.id);
  res.json({ success: true });
});

// Restart bot
router.post('/api/bots/:id/restart', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  await forceStopBot(found.bot.id);
  const result = await startBot(found.bot);
  res.json(result);
});

// Get server access credentials (owner/admin only)
router.get('/api/bots/:id/credentials', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  if (req.user.role === 'server') return res.status(403).json({ error: 'غير مسموح' });
  const access = state.users.find(u => u.role === 'server' && u.botId === found.bot.id);
  res.json({ username: access ? access.username : null, password: access ? decryptPw(access.passwordEnc) : null });
});

// Regenerate server access credentials (owner/admin only)
router.post('/api/bots/:id/credentials', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ error: found.error });
    if (req.user.role === 'server') return res.status(403).json({ error: 'غير مسموح' });
    await removeServerAccessForBots([found.bot.id]);
    const credentials = await createServerAccess(found.bot.id);
    res.json({ success: true, credentials });
  } catch (err) {
    console.error('Regenerate credentials error:', err);
    res.status(500).json({ success: false, error: 'فشل توليد بيانات الدخول' });
  }
});

// Get logs
router.get('/api/bots/:id/logs', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  res.json({ logs: getBotLogs(found.bot.id, limit) });
});

module.exports = router;
