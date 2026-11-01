'use strict';
// رفع الملفات (multer) + تنظيف الملفات المؤقتة
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { TMP_DIR, UPLOAD_MAX_MB } = require('./config');
const { safePath, isSafeRelativePath, sanitizeFilename } = require('./utils');

// Sweep stale temp files left by interrupted uploads
function sweepTmp() {
  fs.readdir(TMP_DIR).then(async names => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const n of names) {
      const p = path.join(TMP_DIR, n);
      try { const st = await fs.stat(p); if (st.isFile() && st.mtimeMs < cutoff) await fs.remove(p); } catch (_) { /* ignore */ }
    }
  }).catch(() => {});
}
sweepTmp();
setInterval(sweepTmp, 30 * 60 * 1000).unref();

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
});

async function storeUpload(botPath, relativeDir, file) {
  let destDir = botPath;
  if (relativeDir) {
    if (!isSafeRelativePath(relativeDir)) return { error: 'مسار مجلد غير صالح' };
    const resolvedDir = safePath(botPath, relativeDir);
    if (!resolvedDir) return { error: 'مسار مجلد غير صالح' };
    destDir = resolvedDir;
  }

  const safeName = sanitizeFilename(file.originalname);
  if (!safeName) {
    await fs.remove(file.path).catch(() => {});
    return { error: 'اسم ملف غير صالح' };
  }

  await fs.ensureDir(destDir);
  const destPath = path.join(destDir, safeName);

  if (await fs.pathExists(destPath)) {
    const stat = await fs.stat(destPath);
    if (stat.isDirectory()) {
      await fs.remove(file.path).catch(() => {});
      return { error: 'يوجد مجلد بنفس الاسم' };
    }
  }

  try {
    await fs.move(file.path, destPath, { overwrite: true });
  } catch (err) {
    await fs.remove(file.path).catch(() => {});
    throw err;
  }
  return { file: safeName };
}

module.exports = { upload, storeUpload };
