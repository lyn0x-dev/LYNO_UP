'use strict';
const state = require('../state');
const { SESSION_TTL_HOURS } = require('../config');
const { safeRouter } = require('../utils');
const {
  createSessionToken, verifySessionToken, getRequestToken,
  hashPassword, verifyPassword, DUMMY_HASH, encryptPw,
} = require('../auth');
const { withUsers, publicUser } = require('../store');
const { setSessionCookie } = require('../middleware');

// ====== حماية تخمين كلمة المرور ======
// بنعدّ المحاولات الغلط بس (الدخول الصح مش بيتحسب)، عشان ناس كتير على نفس الـ IP
// (شبكة موبايل / بروكسي) ما يتقفلوش على بعض.
const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginFails = new Map(); // ip -> { count, reset }

function loginBlockedFor(ip) {
  const rec = loginFails.get(ip);
  if (!rec || Date.now() > rec.reset || rec.count < LOGIN_MAX_FAILS) return 0;
  return Math.ceil((rec.reset - Date.now()) / 1000);
}
function recordLoginFailure(ip) {
  const now = Date.now();
  let rec = loginFails.get(ip);
  if (!rec || now > rec.reset) rec = { count: 0, reset: now + LOGIN_WINDOW_MS };
  rec.count += 1;
  loginFails.set(ip, rec);
}
function clearLoginFailures(ip) { loginFails.delete(ip); }
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginFails) if (now > rec.reset) loginFails.delete(ip);
}, 60000).unref();

// ====== بدون تسجيل دخول ======
const publicRouter = safeRouter();

publicRouter.post('/api/auth/login', (req, res) => {
  const wait = loginBlockedFor(req.ip);
  if (wait) return res.status(429).json({ error: `محاولات دخول كتير غلط - انتظر ${wait} ثانية` });
  const { username, password } = req.body || {};
  const name = String(username || '').trim().toLowerCase();
  const user = state.users.find(u => u.username.toLowerCase() === name);

  const valid = user ? verifyPassword(password, user.passwordHash) : (verifyPassword(password, DUMMY_HASH), false);
  if (!user || !valid) {
    recordLoginFailure(req.ip);
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غلط' });
  }
  if (user.suspended) {
    return res.status(403).json({ error: 'هذا الحساب موقوف، كلم الإدارة' });
  }

  clearLoginFailures(req.ip);
  const token = createSessionToken(user.id);
  setSessionCookie(req, res, token);
  res.json({ success: true, user: publicUser(user), token });
});

publicRouter.post('/api/auth/logout', (req, res) => {
  res.clearCookie('panel_session', { path: '/' });
  res.json({ success: true });
});

publicRouter.get('/api/auth/me', (req, res) => {
  const session = verifySessionToken(getRequestToken(req));
  const user = session ? state.users.find(u => u.id === session.userId) : null;
  if (!user || user.suspended) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: publicUser(user) });
});

// ====== محتاجة تسجيل دخول ======
const router = safeRouter();

// Change own password
router.post('/api/auth/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!verifyPassword(currentPassword, req.user.passwordHash)) {
      return res.status(400).json({ success: false, error: 'كلمة المرور الحالية غلط' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'كلمة المرور الجديدة لازم 6 أحرف على الأقل' });
    }
    const newHash = hashPassword(newPassword);
    await withUsers(users => {
      const u = users.find(x => x.id === req.user.id);
      if (u) { u.passwordHash = newHash; if (u.role === 'server') u.passwordEnc = encryptPw(newPassword); }
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, error: 'فشل تغيير كلمة المرور' });
  }
});

module.exports = { publicRouter, router };
