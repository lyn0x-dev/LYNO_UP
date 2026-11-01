'use strict';
// WebSocket: لوجات مباشرة + إرسال أوامر للكونسول
const WebSocket = require('ws');
const state = require('./state');
const { parseCookies, verifySessionToken } = require('./auth');
const { getBotById } = require('./store');
const { canAccessBot } = require('./middleware');
const { runningBots } = require('./botManager');
const { clients } = require('./ws');

const wss = new WebSocket.Server({ noServer: true });

function attachWebSocket(srv) {
  srv.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
}

// ====== WebSocket auth ======
// ====== WebSocket auth ======
wss.on('connection', (ws, req) => {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  let wsToken = cookies.panel_session;
  let session = verifySessionToken(wsToken);
  if (!session) {
    try {
      const q = new URL(req.url || '/', 'http://x').searchParams.get('token');
      session = verifySessionToken(q);
    } catch (_) { /* ignore */ }
  }
  const user = session ? state.users.find(u => u.id === session.userId) : null;
  if (!user || user.suspended) {
    ws.close(4401, 'Unauthorized');
    return;
  }
  ws.userId = user.id;
  ws.role = user.role;
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || msg.type !== 'command' || typeof msg.command !== 'string') return;
    const command = msg.command;
    if (!command.trim() || command.length > 2000) return;

    const sendError = (error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command-error', botId: msg.botId, error }));
      }
    };

    const bot = await getBotById(String(msg.botId || '')).catch(() => null);
    if (!bot) return sendError('السيرفر غير موجود');
    const current = state.users.find(u => u.id === ws.userId);
    if (!current || current.suspended || !canAccessBot(current, bot)) {
      return sendError('غير مصرح بإرسال أوامر لهذا السيرفر');
    }
    const entry = runningBots.get(bot.id);
    if (!entry || !entry.process.stdin || entry.process.stdin.destroyed) {
      return sendError('السيرفر متوقف أو لا يقبل الأوامر الآن');
    }
    try {
      entry.process.stdin.write(command.endsWith('\n') ? command : `${command}\n`);
    } catch (err) {
      sendError(`فشل إرسال الأمر: ${err.message}`);
    }
  });
});

module.exports = { attachWebSocket };
