'use strict';
// تجميع تطبيق Express: الـ middleware + الراوتات + معالج الأخطاء
const path = require('path');
const fs = require('fs-extra');
const express = require('express');
const multer = require('multer');
const { ROOT_DIR, PUBLIC_URL, JSON_BODY_LIMIT, UPLOAD_MAX_MB } = require('./config');
const { rateLimit } = require('./utils');
const { requireAuth } = require('./middleware');
const { createBundle } = require('./bundle');
require('./uploads'); // بيشغّل تنظيف الملفات المؤقتة

const app = express();

// ====== App Middleware ======
app.disable('x-powered-by');
app.set('trust proxy', 1);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Serve index.html with absolute URLs in the Open Graph / Twitter meta tags
// (link previews on WhatsApp/Discord/Telegram need absolute og:image URLs).
// بنعيد قراءة الملف أوتوماتيك لما يتعدّل — مش لازم ترستر السيرفر بعد تعديل index.html.
const INDEX_FILE = path.join(ROOT_DIR, 'public', 'index.html');
let indexCache = { mtime: 0, html: '' };
function serveIndex(req, res, next) {
  try {
    const mtime = fs.statSync(INDEX_FILE).mtimeMs;
    if (indexCache.mtime !== mtime) indexCache = { mtime, html: fs.readFileSync(INDEX_FILE, 'utf8') };
    let base = PUBLIC_URL;
    if (!base) {
      const host = String(req.get('host') || '');
      if (/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) base = `${req.protocol}://${host}`;
    }
    res.type('html').set('Cache-Control', 'no-cache').send(indexCache.html.replace(/%%BASE_URL%%/g, base));
  } catch (e) { next(e); }
}
app.get(['/', '/index.html'], serveIndex);
// الواجهة: public/css/*.css و public/js/*.js بتتجمّع تلقائي وتتخدم كـ /style.css و /app.js
app.get('/style.css', createBundle(path.join(ROOT_DIR, 'public', 'css'), '.css', 'text/css; charset=utf-8'));
app.get('/app.js', createBundle(path.join(ROOT_DIR, 'public', 'js'), '.js', 'application/javascript; charset=utf-8'));
app.use(express.static(path.join(ROOT_DIR, 'public')));

// ====== Multer ======
// Remove the temp file if the client disconnects mid-upload (common on flaky mobile networks)
app.use('/api', (req, res, next) => {
  res.on('close', () => {
    if (!res.writableEnded && req.file && req.file.path) fs.remove(req.file.path).catch(() => {});
  });
  next();
});

// ====== API ======
app.use('/api', rateLimit(req => `api:${req.ip}`, 600, 60 * 1000));

// بدون تسجيل دخول: login / logout / me
const auth = require('./routes/auth');
app.use(auth.publicRouter);

// كل اللي بعد كده محتاج تسجيل دخول
app.use('/api', requireAuth);
app.use(auth.router);
app.use(require('./routes/users'));
app.use(require('./routes/bots'));
app.use(require('./routes/files'));
app.use(require('./routes/deps'));
app.use(require('./routes/system'));

// أي مسار /api مش موجود
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// ====== Multer / error handler (must be last) ======
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `حجم الملف أكبر من ${UPLOAD_MAX_MB}MB`
      : 'خطأ في رفع الملف';
    return res.status(400).json({ success: false, error: message });
  }
  if (err && (err.message === 'Unexpected end of form' || err.code === 'ECONNRESET' || err.type === 'request.aborted')) {
    return res.status(400).json({ success: false, error: 'انقطع الاتصال أثناء الرفع، حاول تاني' });
  }
  console.error(err);
  res.status(500).json({ success: false, error: 'خطأ في الخادم' });
});

module.exports = app;
