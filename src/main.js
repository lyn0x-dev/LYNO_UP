'use strict';
// نقطة بدء اللوحة: تجهيز البيانات، فتح البورت (HTTP + HTTPS)، بوت تيليجرام، الإغلاق الآمن
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const {
  PORT, HOST, PLATFORM_URL, DISABLE_HTTPS, TLS_DIR, TMP_DIR,
  MAX_RUNNING_BOTS, BOT_MEMORY_MB, UPLOAD_MAX_MB,
  TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE, TELEGRAM_ALLOWED_IDS, TELEGRAM_ENABLED,
} = require('./config');
const state = require('./state');
const app = require('./app');
const { hashPassword, verifyPassword, createSessionToken, DUMMY_HASH } = require('./auth');
const { loadUsers, loadBots, saveBots, withUsers, publicUser } = require('./store');
const { cancelAllRestarts, killAllBots } = require('./botManager');
const { attachWebSocket } = require('./wsServer');
const { createTelegramBot } = require('../lib/telegram');

// أخطاء غير متوقعة تتسجّل في اللوج بس — اللوحة (وكل السيرفرات الشغالة) ما تقعش بسببها
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});

const server = http.createServer(app);
attachWebSocket(server);
// Slow mobile uploads can take minutes: disable Node's default 5-minute whole-request timeout
// Slow mobile uploads can take minutes: disable Node's default 5-minute whole-request timeout
function relaxTimeouts(srv) {
  srv.requestTimeout = 0;
  srv.headersTimeout = 65 * 1000;
  srv.keepAliveTimeout = 65 * 1000;
  srv.timeout = 0;
}
relaxTimeouts(server);
state.frontServer = server; // what actually listens (HTTP only, or HTTP+HTTPS on one port)

// ====== Graceful shutdown ======
function shutdown() {
  state.shuttingDown = true;
  cancelAllRestarts();
  if (state.telegramBot) state.telegramBot.stop();
  killAllBots();
  state.frontServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGHUP', shutdown);
// Safety net: never leave detached bot process groups behind if the panel dies.
process.on('exit', killAllBots);

// ====== Bootstrap ======
// ====== Bootstrap ======
async function bootstrap() {
  state.users = await loadUsers();

  if (state.users.length === 0) {
    const username = (process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
    let password = process.env.ADMIN_PASSWORD || process.env.PANEL_PASSWORD;
    let generated = false;
    if (!password) {
      password = crypto.randomBytes(9).toString('base64url');
      generated = true;
    }
    const admin = {
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      role: 'admin',
      maxBots: 0,
      suspended: false,
      createdAt: Date.now(),
    };
    await withUsers(users => { users.push(admin); });
    console.log('');
    console.log('  =========================================================');
    console.log('  Admin account created');
    console.log(`    Username: ${username}`);
    if (generated) {
      console.log(`    Password: ${password}`);
      console.log('  (set ADMIN_PASSWORD in .env for a permanent password)');
    } else {
      console.log('    Password: (from ADMIN_PASSWORD env)');
    }
    console.log('  =========================================================');
    console.log('');
  }

  // Keep the admin password in sync with ADMIN_PASSWORD env (authoritative)
  const envPassword = process.env.ADMIN_PASSWORD || process.env.PANEL_PASSWORD;
  if (envPassword) {
    const envUsername = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
    const target = (envUsername && state.users.find(u => u.role === 'admin' && u.username.toLowerCase() === envUsername))
      || state.users.find(u => u.role === 'admin');
    if (target && !verifyPassword(envPassword, target.passwordHash)) {
      await withUsers(users => {
        const u = users.find(x => x.id === target.id);
        if (u) u.passwordHash = hashPassword(envPassword);
      });
      console.log(`  Admin password synced from ADMIN_PASSWORD env (user: ${target.username})`);
    }
  }

  // Migrate legacy bots (no owner) to the first admin
  const admin = state.users.find(u => u.role === 'admin')
    || state.users.find(u => u.role !== 'server')
    || state.users[0];
  if (admin) {
    const bots = await loadBots();
    let changed = false;
    for (const bot of bots) {
      if (!bot.ownerId) {
        bot.ownerId = admin.id;
        changed = true;
      }
    }
    if (changed) await saveBots(bots);
  }
}

// ====== One port, both protocols ======
// Phones/browsers often force https:// even though the hosting port speaks plain HTTP
// (ERR_SSL_PROTOCOL_ERROR). We sniff the first byte of each connection: a TLS handshake
// (0x16) goes to an HTTPS server (self-signed cert), anything else goes to plain HTTP.
let tlsServer = null;

async function loadOrCreateCert() {
  const keyFile = path.join(TLS_DIR, 'key.pem');
  const certFile = path.join(TLS_DIR, 'cert.pem');
  if (await fs.pathExists(keyFile) && await fs.pathExists(certFile)) {
    return { key: await fs.readFile(keyFile), cert: await fs.readFile(certFile) };
  }
  const selfsigned = require('selfsigned');
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'lynox-panel' }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 2, value: '*.hidencloud.com' }] }],
  });
  await fs.ensureDir(TLS_DIR);
  await fs.writeFile(keyFile, pems.private, { mode: 0o600 });
  await fs.writeFile(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

async function createFrontServer() {
  if (DISABLE_HTTPS) return server;
  try {
    tlsServer = https.createServer(await loadOrCreateCert(), app);
    attachWebSocket(tlsServer);
    relaxTimeouts(tlsServer);
  } catch (err) {
    console.error('HTTPS disabled (could not prepare certificate):', err.message);
    tlsServer = null;
    return server;
  }
  return net.createServer(socket => {
    socket.once('error', () => socket.destroy());
    // اتصال فاتح ومابيبعتش حاجة؟ نقفله (بدل ما يفضل معلّق للأبد)
    socket.setTimeout(15000, () => socket.destroy());
    socket.once('data', chunk => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(chunk);
      (chunk[0] === 0x16 ? tlsServer : server).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
}

// ====== Telegram control bot ======
// Login mirrors /api/auth/login but skips the HTTP rate limit (the bot shares
// the loopback IP, so per-IP counting would lock it out).
function authenticateForBot(username, password) {
  const name = String(username || '').trim().toLowerCase();
  const user = state.users.find(u => u.username.toLowerCase() === name);
  const valid = user ? verifyPassword(password, user.passwordHash) : (verifyPassword(password, DUMMY_HASH), false);
  if (!user || !valid || user.suspended) return null;
  return { token: createSessionToken(user.id), user: publicUser(user) };
}

function startTelegramBot() {
  if (!TELEGRAM_ENABLED) return;
  try {
    state.telegramBot = createTelegramBot({
      token: TELEGRAM_BOT_TOKEN,
      apiBase: TELEGRAM_API_BASE || undefined,
      panelBase: `http://127.0.0.1:${PORT}`,
      tmpDir: TMP_DIR,
      maxUploadMb: UPLOAD_MAX_MB,
      allowedIds: TELEGRAM_ALLOWED_IDS.length ? new Set(TELEGRAM_ALLOWED_IDS) : null,
      authenticate: authenticateForBot,
    });
    state.telegramBot.start();
  } catch (err) {
    console.error('Failed to start Telegram bot:', err.message);
  }
}

// ====== Start ======
bootstrap()
  .then(() => createFrontServer())
  .then((front) => {
    state.frontServer = front;
    front.listen(PORT, HOST, () => {
      console.log(`🚀 LYNO UP Control running on http://${HOST}:${PORT}` + (tlsServer ? ' (HTTP + HTTPS on the same port)' : ''));
      console.log(`🌍 Public URL: ${PLATFORM_URL}`);
      console.log(`📦 Limits: ${MAX_RUNNING_BOTS} servers max, ${BOT_MEMORY_MB}MB/server, ${UPLOAD_MAX_MB}MB uploads`);
      startTelegramBot();
    });
  })
  .catch((err) => {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  });
