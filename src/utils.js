'use strict';
const path = require('path');
const express = require('express');

// ====== Rate Limiting ======
const rateBuckets = new Map();

function rateLimit(keyFn, max, windowMs) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const wait = Math.ceil((bucket.reset - now) / 1000);
      return res.status(429).json({ error: `طلبات كثيرة جداً - انتظر ${wait} ثانية` });
    }
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.reset) rateBuckets.delete(key);
  }
}, 60000).unref();

// ====== Path Safety / sanitizers ======
function safePath(base, relative) {
  if (typeof relative !== 'string' || !relative.trim()) return null;
  if (relative.length > 500) return null;
  const resolved = path.resolve(base, relative);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved === base) return null;
  if (!resolved.startsWith(baseWithSep)) return null;
  return resolved;
}

function isSafeRelativePath(relative) {
  if (typeof relative !== 'string' || !relative.trim() || relative.trim().length > 200) return false;
  if (path.isAbsolute(relative)) return false;
  const normalized = path.normalize(relative.trim());
  if (normalized.startsWith('..')) return false;
  if (normalized.split(/[\\/]/).includes('..')) return false;
  if (path.isAbsolute(normalized)) return false;
  return true;
}

function isValidBotId(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
}

function sanitizeFilename(name) {
  let base = path.basename(String(name || ''));
  base = base.replace(/[^\w.\-() \[\]]/g, '_');
  if (!base || /^\.+$/.test(base)) return null;
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = '_' + base;
  if (base.length > 120) base = base.slice(0, 120);
  return base;
}

function sanitizeEnv(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 100) break;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) continue;
    if (value === null || value === undefined) continue;
    const type = typeof value;
    if (type === 'object' || type === 'function' || type === 'symbol') continue;
    out[key] = String(value).slice(0, 4096);
    count += 1;
  }
  return out;
}

// ====== Router that catches async errors ======
// Express 4 doesn't catch rejected promises from async handlers: an unexpected
// error would hang the request (and, on modern Node, can crash the whole panel).
// Every handler registered through this router is wrapped so errors reach the
// error middleware instead.
function wrapHandler(h) {
  if (typeof h !== 'function' || h.length >= 4) return h;
  return (req, res, next) => {
    try {
      const result = h(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) { next(err); }
  };
}

function safeRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    const original = router[method].bind(router);
    router[method] = (route, ...handlers) => original(route, ...handlers.map(wrapHandler));
  }
  return router;
}

// Content-Disposition value that is safe for non-ASCII (Arabic) file names
function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

module.exports = {
  rateLimit, safePath, isSafeRelativePath, isValidBotId, sanitizeFilename, sanitizeEnv,
  wrapHandler, safeRouter, contentDisposition,
};
