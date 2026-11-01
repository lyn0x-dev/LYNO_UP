'use strict';
// بث الأحداث (لوجات / حالة / إحصائيات) لمتصفحات المستخدمين.
// أي رسالة مرتبطة بسيرفر معيّن بتتبعت بس لمن يملك صلاحية عليه (الأدمن / المالك / حساب السيرفر)،
// عشان لوجات سيرفر مستخدم ما توصلش لمستخدم تاني.
const WebSocket = require('ws');
const state = require('./state');

const clients = new Set();

function canSeeBot(ws, botId) {
  const user = state.users.find(u => u.id === ws.userId);
  if (!user || user.suspended) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'server') return user.botId === botId;
  return state.botOwners.get(botId) === user.id;
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (data.botId && !canSeeBot(ws, data.botId)) continue;
    ws.send(msg);
  }
}

module.exports = { clients, broadcast };
