'use strict';
// يجمّع ملفات الواجهة الصغيرة ويخدمها كملف واحد:
//   public/css/*.css  ->  /style.css
//   public/js/*.js    ->  /app.js
// الترتيب بالاسم (01- ثم 02- ...). عدّل أي ملف وحدّث الصفحة — مفيش build ولا ريستارت.
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

function createBundle(dir, ext, contentType) {
  let cache = { sig: '', body: '', etag: '' };
  return (req, res, next) => {
    try {
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort() : [];
      if (!files.length) return next(); // مفيش ملفات مقسّمة -> نسيب express.static يخدم الملف العادي
      const sig = files.map(f => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join('|');
      if (sig !== cache.sig) {
        const body = files
          .map(f => `/* ===== ${f} ===== */\n${fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '')}`)
          .join('\n');
        cache = { sig, body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
      }
      if (req.headers['if-none-match'] === cache.etag) return res.status(304).end();
      res.set({ 'Content-Type': contentType, ETag: cache.etag, 'Cache-Control': 'no-cache' }).send(cache.body);
    } catch (err) { next(err); }
  };
}

module.exports = { createBundle };
