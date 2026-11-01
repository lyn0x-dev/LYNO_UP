'use strict';
// إدارة المستخدمين (للأدمن فقط)
const crypto = require('crypto');
const fs = require('fs-extra');
const state = require('../state');
const { safeRouter } = require('../utils');
const { hashPassword, encryptPw, randomPassword } = require('../auth');
const { loadBots, withDb, withUsers, publicUser } = require('../store');
const { requireAdmin } = require('../middleware');
const { uniqueServerUsername, removeServerAccessForBots } = require('../accounts');
const { getBotPath, forceStopBot } = require('../botManager');

const router = safeRouter();

// ====== Users (admin only) ======
router.get('/api/users', requireAdmin, async (req, res) => {
  const bots = await loadBots();
  const counts = new Map();
  for (const b of bots) counts.set(b.ownerId, (counts.get(b.ownerId) || 0) + 1);
  res.json(state.users.filter(u => u.role !== 'server').map(u => ({ ...publicUser(u), serverCount: counts.get(u.id) || 0 })));
});

router.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const role = body.role;
    const maxBots = body.maxBots;

    let name = String(body.username || '').trim();
    let password = typeof body.password === 'string' ? body.password : '';
    let generatedUsername = false;
    let generatedPassword = false;

    if (!name) {
      name = uniqueServerUsername();
      generatedUsername = true;
    }
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(name)) {
      return res.status(400).json({ success: false, error: 'اسم المستخدم لازم 3-32 حرف (حروف إنجليزية/أرقام/_.-)' });
    }
    if (state.users.some(u => u.username.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ success: false, error: 'اسم المستخدم موجود بالفعل' });
    }
    if (!password) {
      password = randomPassword();
      generatedPassword = true;
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'كلمة المرور لازم 6 أحرف على الأقل' });
    }

    const userRole = role === 'admin' ? 'admin' : 'user';
    const limit = Math.max(0, parseInt(maxBots, 10) || 0);

    const user = {
      id: crypto.randomUUID(),
      username: name,
      passwordHash: hashPassword(password),
      role: userRole,
      maxBots: limit,
      suspended: false,
      createdAt: Date.now(),
    };
    await withUsers(users => { users.push(user); });
    res.json({
      success: true,
      user: publicUser(user),
      credentials: { username: name, password },
      generated: generatedUsername || generatedPassword,
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ success: false, error: 'فشل إنشاء المستخدم' });
  }
});

// Regenerate an account's password (admin only) -> returns the new plaintext once
router.post('/api/users/:id/credentials', requireAdmin, async (req, res) => {
  try {
    const target = state.users.find(u => u.id === req.params.id && u.role !== 'server');
    if (!target) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    const body = req.body || {};
    let password = typeof body.password === 'string' ? body.password : '';
    if (!password) password = randomPassword();
    if (password.length < 6) return res.status(400).json({ success: false, error: 'كلمة المرور لازم 6 أحرف على الأقل' });

    await withUsers(users => {
      const u = users.find(x => x.id === target.id);
      if (u) { u.passwordHash = hashPassword(password); if (u.role === 'server') u.passwordEnc = encryptPw(password); }
    });
    res.json({ success: true, credentials: { username: target.username, password } });
  } catch (err) {
    console.error('Regenerate account credentials error:', err);
    res.status(500).json({ success: false, error: 'فشل توليد كلمة المرور' });
  }
});

router.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const target = state.users.find(u => u.id === req.params.id);
    if (!target) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

    const body = req.body || {};
    const patch = {};

    if (body.password !== undefined) {
      if (typeof body.password !== 'string' || body.password.length < 6) {
        return res.status(400).json({ success: false, error: 'كلمة المرور لازم 6 أحرف على الأقل' });
      }
      patch.passwordHash = hashPassword(body.password);
      if (target.role === 'server') patch.passwordEnc = encryptPw(body.password);
    }
    if (body.role !== undefined && target.role !== 'server') {
      patch.role = body.role === 'admin' ? 'admin' : 'user';
    }
    if (body.maxBots !== undefined) {
      patch.maxBots = Math.max(0, parseInt(body.maxBots, 10) || 0);
    }
    if (body.suspended !== undefined) {
      patch.suspended = Boolean(body.suspended);
    }

    const activeAdmins = state.users.filter(u => u.role === 'admin' && !u.suspended).length;
    const losesAdmin = target.role === 'admin' && (patch.role === 'user' || patch.suspended === true);
    if (losesAdmin && activeAdmins <= 1) {
      return res.status(400).json({ success: false, error: 'لازم يفضل مشرف واحد على الأقل شغال' });
    }

    const updated = await withUsers(users => {
      const u = users.find(x => x.id === target.id);
      if (!u) return null;
      Object.assign(u, patch);
      return u;
    });
    if (!updated) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    res.json({ success: true, user: publicUser(updated) });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'فشل تحديث المستخدم' });
  }
});

router.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const target = state.users.find(u => u.id === req.params.id);
    if (!target) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
    if (target.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'مش ممكن تحذف حسابك الحالي' });
    }
    const activeAdmins = state.users.filter(u => u.role === 'admin' && !u.suspended).length;
    if (target.role === 'admin' && !target.suspended && activeAdmins <= 1) {
      return res.status(400).json({ success: false, error: 'لازم يفضل مشرف واحد على الأقل' });
    }

    const bots = await loadBots();
    const owned = bots.filter(b => b.ownerId === target.id);
    for (const b of owned) await forceStopBot(b.id);

    await withDb(all => {
      for (let i = all.length - 1; i >= 0; i -= 1) {
        if (all[i].ownerId === target.id) all.splice(i, 1);
      }
    });
    for (const b of owned) await fs.remove(getBotPath(b.id)).catch(() => {});

    await removeServerAccessForBots(owned.map(b => b.id));

    await withUsers(users => {
      const idx = users.findIndex(u => u.id === target.id);
      if (idx !== -1) users.splice(idx, 1);
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ success: false, error: 'فشل حذف المستخدم' });
  }
});

module.exports = router;
