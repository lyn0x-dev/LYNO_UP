'use strict';
// الجلسات + تشفير كلمات المرور
const crypto = require('crypto');
const fs = require('fs-extra');
const { SECRET_FILE, SESSION_TTL_HOURS } = require('./config');

function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch (_) { /* ignore */ }
  const generated = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, generated); } catch (_) { /* ignore */ }
  return generated;
}
const SESSION_SECRET = getSessionSecret();

function sessionSignature(userId, exp) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}.${exp}`).digest('base64url');
}

function createSessionToken(userId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_HOURS * 3600;
  return `${userId}.${exp}.${sessionSignature(userId, exp)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!userId || userId.length > 64 || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const given = Buffer.from(sig);
  const expected = Buffer.from(sessionSignature(userId, exp));
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;
  return { userId, exp };
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const raw = part.slice(idx + 1).trim();
    let val = raw;
    try { val = decodeURIComponent(raw); } catch (_) { /* keep raw */ }
    out[part.slice(0, idx).trim()] = val;
  }
  return out;
}

function getRequestToken(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  if (cookies.panel_session) return cookies.panel_session;
  const auth = req.headers && req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

// ====== Password hashing (scrypt) ======
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

function pwKey() { return crypto.createHash('sha256').update('srvpw:' + SESSION_SECRET).digest(); }
function encryptPw(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', pwKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${iv.toString('hex')}.${c.getAuthTag().toString('hex')}.${enc.toString('hex')}`;
}
function decryptPw(blob) {
  try {
    const [iv, tag, enc] = String(blob || '').split('.').map(h => Buffer.from(h, 'hex'));
    const d = crypto.createDecipheriv('aes-256-gcm', pwKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (_) { return null; }
}

function randomPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = {
  SESSION_SECRET,
  createSessionToken, verifySessionToken, parseCookies, getRequestToken,
  hashPassword, verifyPassword, DUMMY_HASH,
  encryptPw, decryptPw, randomPassword,
};
