'use strict';
// تنصيب المكتبات (npm install) داخل مجلد السيرفر
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { safeRouter } = require('../utils');
const { findAccessibleBot } = require('../middleware');
const { getBotPath, buildBotEnv, appendBotLog } = require('../botManager');

const router = safeRouter();

// Install dependencies (npm install) for a bot
const installingBots = new Set();
router.post('/api/bots/:id/install', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ success: false, error: found.error });
  const bot = found.bot;

  if (installingBots.has(bot.id)) {
    return res.status(409).json({ success: false, error: 'التنصيب شغال بالفعل، استنى لما يخلص' });
  }

  // الاسم لازم يبدأ بحرف/رقم (يمنع تمرير خيارات زي --global) والإصدار بحروف آمنة بس (بدون < > | عشان ويندوز بيشغّل npm عبر shell)
  const PKG_RE = /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9.^~*=+._-]+)?$/;
  const body = req.body || {};
  let packages = [];
  if (Array.isArray(body.packages)) {
    packages = body.packages.map(p => String(p).trim()).filter(Boolean);
  } else if (typeof body.packages === 'string' && body.packages.trim()) {
    packages = body.packages.split(/[\s,]+/).map(p => p.trim()).filter(Boolean);
  }
  if (packages.length > 50) {
    return res.status(400).json({ success: false, error: 'عدد كبير أوي من المكتبات' });
  }
  for (const p of packages) {
    if (!PKG_RE.test(p)) return res.status(400).json({ success: false, error: `اسم مكتبة غير صالح: ${p}` });
  }

  const botPath = getBotPath(bot.id);
  await fs.ensureDir(botPath);

  // Ensure the bot has its own package.json so npm installs INTO the bot folder
  // (otherwise npm walks up and installs into the panel's root node_modules).
  const pkgFile = path.join(botPath, 'package.json');
  if (!await fs.pathExists(pkgFile)) {
    await fs.writeFile(pkgFile, JSON.stringify({ name: 'bot-server', version: '1.0.0', private: true }, null, 2));
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['install', '--no-audit', '--no-fund', '--loglevel=info'];
  if (packages.length) args.push(...packages);

  installingBots.add(bot.id);
  appendBotLog(bot.id, `\n$ npm install ${packages.join(' ')}\n`, 'out');

  let output = '';
  let clientGone = false;
  const child = spawn(npmCmd, args, {
    cwd: botPath,
    env: buildBotEnv(bot),
    windowsHide: true,
    shell: process.platform === 'win32',
  });

  const onData = (data, type) => {
    const text = data.toString();
    output += text;
    if (output.length > 200000) output = output.slice(-200000);
    appendBotLog(bot.id, text, type);
  };
  child.stdout.on('data', d => onData(d, 'out'));
  child.stderr.on('data', d => onData(d, 'err'));

  const timer = setTimeout(() => {
    appendBotLog(bot.id, '\n[install] انتهى الوقت المسموح، جاري الإلغاء...\n', 'err');
    try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }
  }, 240000);

  child.on('error', (err) => {
    clearTimeout(timer);
    installingBots.delete(bot.id);
    appendBotLog(bot.id, `\n[install] خطأ: ${err.message}\n`, 'err');
    if (!clientGone) res.status(500).json({ success: false, error: 'فشل تشغيل npm: ' + err.message });
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    installingBots.delete(bot.id);
    const ok = code === 0;
    appendBotLog(bot.id, `\n[install] ${ok ? 'تم التنصيب بنجاح ✅' : 'فشل التنصيب ❌'} (code ${code})\n`, ok ? 'out' : 'err');
    if (!clientGone) res.json({ success: ok, code, output: output.slice(-20000), installed: packages });
  });

  res.on('close', () => { if (!res.writableFinished) clientGone = true; });
});

module.exports = router;
