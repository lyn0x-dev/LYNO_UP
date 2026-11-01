'use strict';
const state = require('./state');
const { SESSION_TTL_HOURS } = require('./config');
const { createSessionToken, verifySessionToken, getRequestToken } = require('./auth');
const { getBotById } = require('./store');

// ====== Access control ======
function canAccessBot(user, bot) {
  if (user.role === 'admin') return true;
  if (user.role === 'server') return bot.id === user.botId;
  return bot.ownerId === user.id;
}

async function findAccessibleBot(user, id) {
  const bot = await getBotById(id);
  if (!bot) return { status: 404, error: 'Bot not found' };
  if (!canAccessBot(user, bot)) return { status: 403, error: 'لا تملك صلاحية الوصول لهذا السيرفر' };
  return { bot };
}

function setSessionCookie(req, res, token) {
  res.cookie('panel_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600 * 1000,
  });
}

function requireAuth(req, res, next) {
  const session = verifySessionToken(getRequestToken(req));
  if (!session) return res.status(401).json({ error: 'غير مصرح - سجل الدخول أولاً' });
  const user = state.users.find(u => u.id === session.userId);
  if (!user || user.suspended) return res.status(401).json({ error: 'الحساب غير موجود أو موقوف' });
  req.user = user;
  // Sliding session: renew when less than half of the lifetime is left (mobile users stay logged in)
  if (session.exp - Math.floor(Date.now() / 1000) < SESSION_TTL_HOURS * 1800) {
    try {
      const fresh = createSessionToken(user.id);
      setSessionCookie(req, res, fresh);
      res.setHeader('X-Session-Token', fresh);
    } catch (_) { /* ignore */ }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'هذه العملية مخصصة للمشرفين فقط' });
  }
  next();
}

module.exports = { canAccessBot, findAccessibleBot, setSessionCookie, requireAuth, requireAdmin };
