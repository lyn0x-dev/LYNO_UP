'use strict';
// مدير الملفات: رفع / تنزيل / فك ضغط / ضغط / إنشاء / إعادة تسمية / تعديل / حذف
const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const { TMP_DIR, MAX_EXTRACT_MB, EDITOR_MAX_BYTES } = require('../config');
const { safeRouter, safePath, isSafeRelativePath, contentDisposition } = require('../utils');
const { findAccessibleBot } = require('../middleware');
const { upload, storeUpload } = require('../uploads');
const { extractArchive } = require('../../lib/archive');
const { createTarGz } = require('../tar');
const { getBotPath } = require('../botManager');

const router = safeRouter();

// ====== Archive extraction (zip, rar, 7z, tar, tgz, gz, bz2, xz, iso, ...) ======
// Implemented in lib/archive.js on top of 7-Zip (WASM) running in a worker thread.
const MAX_CONCURRENT_EXTRACTS = 2;
let activeExtracts = 0;

// قائمة محتويات مجلد (بتتجاهل أي عنصر اتحذف/لينك مكسور بدل ما تقع بـ 500)
async function listDir(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const item of items) {
    const full = path.join(dir, item.name);
    try {
      const st = await fs.stat(full).catch(() => fs.lstat(full));
      out.push({ name: item.name, isDirectory: item.isDirectory(), size: st.size, modified: st.mtime });
    } catch (_) { /* العنصر اختفى أثناء القراءة */ }
  }
  return out;
}

// Upload file to existing bot
router.post('/api/bots/:id/upload', upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) {
      if (uploaded) await fs.remove(uploaded.path).catch(() => {});
      return res.status(found.status).json({ success: false, error: found.error });
    }
    if (!uploaded) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const stored = await storeUpload(getBotPath(found.bot.id), req.body && req.body.path, uploaded);
    if (stored.error) return res.status(400).json({ success: false, error: stored.error });
    res.json({ success: true, file: stored.file });
  } catch (err) {
    console.error('Upload error:', err);
    if (uploaded) await fs.remove(uploaded.path).catch(() => {});
    res.status(500).json({ success: false, error: 'فشل رفع الملف' });
  }
});

// Extract any archive (zip, rar, 7z, tar, tar.gz, tgz, bz2, xz, gz, iso, cab, ...)
router.post('/api/bots/:id/extract', async (req, res) => {
  let counted = false;
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ success: false, error: found.error });

    const fileRel = String((req.body && req.body.file) || '').trim();
    if (!fileRel || !isSafeRelativePath(fileRel)) {
      return res.status(400).json({ success: false, error: 'مسار الملف غير صالح' });
    }

    const botPath = getBotPath(found.bot.id);
    const archivePath = safePath(botPath, fileRel.split('/').join(path.sep));
    if (!archivePath) return res.status(400).json({ success: false, error: 'مسار الملف غير صالح' });
    if (!await fs.pathExists(archivePath)) return res.status(404).json({ success: false, error: 'الملف غير موجود' });
    const archiveStat = await fs.stat(archivePath);
    if (!archiveStat.isFile()) return res.status(400).json({ success: false, error: 'المسار ليس ملفاً' });

    let destRel = req.body && req.body.dest;
    if (destRel === undefined || destRel === null || destRel === '') {
      const idx = fileRel.lastIndexOf('/');
      destRel = idx === -1 ? '' : fileRel.slice(0, idx);
    }
    destRel = String(destRel).trim();
    if (destRel && !isSafeRelativePath(destRel)) {
      return res.status(400).json({ success: false, error: 'مسار المجلد غير صالح' });
    }
    const destDir = destRel ? safePath(botPath, destRel.split('/').join(path.sep)) : botPath;
    if (!destDir) return res.status(400).json({ success: false, error: 'مسار المجلد غير صالح' });

    const password = req.body && typeof req.body.password === 'string' ? req.body.password.slice(0, 256) : '';

    if (activeExtracts >= MAX_CONCURRENT_EXTRACTS) {
      return res.status(429).json({ success: false, error: 'فيه عمليات فك ضغط شغالة حالياً، حاول بعد شوية' });
    }
    activeExtracts += 1;
    counted = true;

    await fs.ensureDir(destDir);
    const result = await extractArchive(archivePath, destDir, TMP_DIR, {
      maxBytes: MAX_EXTRACT_MB * 1024 * 1024,
      password,
    });
    if (result.error) {
      // 401 is reserved for session expiry in the frontend, so password prompts use 422
      const needsPassword = result.code === 'PASSWORD_REQUIRED' || result.code === 'BAD_PASSWORD';
      return res.status(needsPassword ? 422 : 400).json({ success: false, error: result.error, code: result.code });
    }
    res.json({ success: true, extracted: result.count });
  } catch (err) {
    console.error('Extract error:', err);
    res.status(500).json({ success: false, error: 'فشل فك ضغط الملف' });
  } finally {
    if (counted) activeExtracts -= 1;
  }
});

// Create a folder
router.post('/api/bots/:id/mkdir', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ success: false, error: found.error });
    const rel = String((req.body && req.body.path) || '').trim();
    if (!rel || !isSafeRelativePath(rel)) return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    const target = safePath(getBotPath(found.bot.id), rel.split('/').join(path.sep));
    if (!target) return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    if (await fs.pathExists(target)) return res.status(409).json({ success: false, error: 'موجود بالفعل' });
    await fs.ensureDir(target);
    res.json({ success: true });
  } catch (err) {
    console.error('Mkdir error:', err);
    res.status(500).json({ success: false, error: 'فشل إنشاء المجلد' });
  }
});

// Create an empty file
router.post('/api/bots/:id/newfile', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ success: false, error: found.error });
    const rel = String((req.body && req.body.path) || '').trim();
    if (!rel || !isSafeRelativePath(rel)) return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    const target = safePath(getBotPath(found.bot.id), rel.split('/').join(path.sep));
    if (!target) return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    if (await fs.pathExists(target)) return res.status(409).json({ success: false, error: 'موجود بالفعل' });
    const content = typeof (req.body && req.body.content) === 'string' ? req.body.content : '';
    if (Buffer.byteLength(content, 'utf-8') > EDITOR_MAX_BYTES) return res.status(413).json({ success: false, error: 'المحتوى كبير جداً' });
    await fs.outputFile(target, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('New file error:', err);
    res.status(500).json({ success: false, error: 'فشل إنشاء الملف' });
  }
});

// Rename / move
router.post('/api/bots/:id/rename', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ success: false, error: found.error });
    const from = String((req.body && req.body.from) || '').trim();
    const to = String((req.body && req.body.to) || '').trim();
    if (!from || !to || !isSafeRelativePath(from) || !isSafeRelativePath(to)) {
      return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    }
    const botPath = getBotPath(found.bot.id);
    const fromAbs = safePath(botPath, from.split('/').join(path.sep));
    const toAbs = safePath(botPath, to.split('/').join(path.sep));
    if (!fromAbs || !toAbs) return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    if (!await fs.pathExists(fromAbs)) return res.status(404).json({ success: false, error: 'المصدر غير موجود' });
    if (await fs.pathExists(toAbs)) return res.status(409).json({ success: false, error: 'الاسم الهدف موجود بالفعل' });
    await fs.ensureDir(path.dirname(toAbs));
    await fs.move(fromAbs, toAbs, { overwrite: false });
    res.json({ success: true });
  } catch (err) {
    console.error('Rename error:', err);
    res.status(500).json({ success: false, error: 'فشل إعادة التسمية' });
  }
});

// Create an archive (zip or tar.gz) from selected paths
router.post('/api/bots/:id/archive', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ success: false, error: found.error });
    const body = req.body || {};
    const paths = Array.isArray(body.paths) ? body.paths.slice(0, 500) : [];
    if (!paths.length) return res.status(400).json({ success: false, error: 'اختار ملفات للضغط' });

    const format = body.format === 'tar.gz' ? 'tar.gz' : 'zip';
    const ext = format === 'tar.gz' ? '.tar.gz' : '.zip';
    let destRel = String(body.dest || `archive${ext}`).trim();
    destRel = destRel.replace(/\.(zip|tar\.gz|tgz)$/i, '') + ext;
    if (!isSafeRelativePath(destRel)) return res.status(400).json({ success: false, error: 'مسار غير صالح' });

    const botPath = getBotPath(found.bot.id);
    const destAbs = safePath(botPath, destRel.split('/').join(path.sep));
    if (!destAbs) return res.status(400).json({ success: false, error: 'مسار غير صالح' });
    if (await fs.pathExists(destAbs)) return res.status(409).json({ success: false, error: 'ملف الأرشيف موجود بالفعل' });
    await fs.ensureDir(path.dirname(destAbs));

    const valid = paths.filter(p => typeof p === 'string' && isSafeRelativePath(p));
    let added = 0;
    if (format === 'tar.gz') {
      added = await createTarGz(botPath, valid, destAbs);
    } else {
      const zip = new AdmZip();
      for (const rel of valid) {
        const abs = safePath(botPath, rel.split('/').join(path.sep));
        if (!abs || !await fs.pathExists(abs)) continue;
        const stat = await fs.stat(abs);
        if (stat.isDirectory()) {
          zip.addLocalFolder(abs, rel);
        } else {
          const dir = path.posix.dirname(rel);
          zip.addLocalFile(abs, dir === '.' ? '' : dir, path.posix.basename(rel));
        }
        added += 1;
      }
      if (added) await fs.writeFile(destAbs, zip.toBuffer());
    }
    if (!added) {
      await fs.remove(destAbs).catch(() => {});
      return res.status(400).json({ success: false, error: 'مفيش ملفات صالحة للضغط' });
    }
    res.json({ success: true, file: destRel, count: added });
  } catch (err) {
    console.error('Archive error:', err);
    res.status(500).json({ success: false, error: 'فشل إنشاء الأرشيف' });
  }
});

// Download a file or a folder (as zip)
router.get('/api/bots/:id/download/*', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ error: found.error });
    const rel = String(req.params[0] || '');
    if (!isSafeRelativePath(rel)) return res.status(400).json({ error: 'مسار غير صالح' });
    const botPath = getBotPath(found.bot.id);
    const abs = safePath(botPath, rel.split('/').join(path.sep));
    if (!abs) return res.status(400).json({ error: 'مسار غير صالح' });
    if (!await fs.pathExists(abs)) return res.status(404).json({ error: 'الملف غير موجود' });

    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      const zip = new AdmZip();
      zip.addLocalFolder(abs);
      const buf = zip.toBuffer();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', contentDisposition(`${path.basename(abs)}.zip`));
      return res.send(buf);
    }
    res.download(abs);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'فشل التنزيل' });
  }
});

// Get bot files (root)
router.get('/api/bots/:id/files', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });

  const botPath = getBotPath(found.bot.id);
  if (!await fs.pathExists(botPath)) return res.json([]);

  res.json(await listDir(botPath));
});

// Read file content / list subdirectory
router.get('/api/bots/:id/files/*', async (req, res) => {
  const found = await findAccessibleBot(req.user, req.params.id);
  if (!found.bot) return res.status(found.status).json({ error: found.error });

  const filePath = safePath(getBotPath(found.bot.id), req.params[0]);
  if (!filePath) return res.status(400).json({ error: 'مسار غير صالح' });
  if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'File not found' });

  const stat = await fs.stat(filePath);
  if (stat.isDirectory()) {
    return res.json(await listDir(filePath));
  }

  if (stat.size > EDITOR_MAX_BYTES) return res.status(413).json({ error: 'الملف كبير جداً لفتحه في المحرر' });

  const content = await fs.readFile(filePath, 'utf-8');
  res.json({ content, name: path.basename(filePath) });
});

// Update file content
router.put('/api/bots/:id/files/*', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ error: found.error });

    const filePath = safePath(getBotPath(found.bot.id), req.params[0]);
    if (!filePath) return res.status(400).json({ error: 'مسار غير صالح' });

    if (await fs.pathExists(filePath)) {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) return res.status(400).json({ error: 'لا يمكن حفظ مجلد' });
    }

    const content = req.body && req.body.content;
    if (typeof content !== 'string') return res.status(400).json({ error: 'المحتوى غير صالح' });
    if (Buffer.byteLength(content, 'utf-8') > EDITOR_MAX_BYTES) {
      return res.status(413).json({ error: 'حجم الملف أكبر من المسموح' });
    }

    await fs.outputFile(filePath, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('Save file error:', err);
    res.status(500).json({ error: 'فشل حفظ الملف' });
  }
});

// Delete file
router.delete('/api/bots/:id/files/*', async (req, res) => {
  try {
    const found = await findAccessibleBot(req.user, req.params.id);
    if (!found.bot) return res.status(found.status).json({ error: found.error });

    const filePath = safePath(getBotPath(found.bot.id), req.params[0]);
    if (!filePath) return res.status(400).json({ error: 'مسار غير صالح' });
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'File not found' });

    await fs.remove(filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'فشل حذف الملف' });
  }
});

module.exports = router;
