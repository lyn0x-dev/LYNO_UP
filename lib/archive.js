'use strict';
// Universal, safe archive extraction (zip, rar, 7z, tar, tgz, gz, bz2, xz, iso, cab, ...).
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { Worker } = require('worker_threads');

const WORKER_FILE = path.join(__dirname, 'archive-worker.js');
const MAX_FILES = 20000;
const TIMEOUT_MS = 5 * 60 * 1000;

// Extensions we show an "extract" button for (the backend also sniffs content,
// so a renamed archive still works if called through the API).
const ARCHIVE_EXTS = [
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz', 'lzma', 'z', 'lz',
  'cab', 'iso', 'arj', 'cpio', 'rpm', 'deb', 'wim', 'jar', 'war', 'apk', 'whl', 'vhd', 'dmg',
];
const ARCHIVE_RE = new RegExp(`\\.(${ARCHIVE_EXTS.join('|')})$`, 'i');

function isArchiveName(name) {
  return ARCHIVE_RE.test(String(name || ''));
}

function runWorker(data) {
  return new Promise(resolve => {
    const worker = new Worker(WORKER_FILE, {
      workerData: data,
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(result);
    };
    const timer = setTimeout(
      () => done({ ok: false, code: 'TIMEOUT', message: 'استغرق فك الضغط وقتاً طويلاً وتم إلغاؤه' }),
      TIMEOUT_MS
    );
    worker.on('message', done);
    worker.on('error', () => done({ ok: false, code: 'FAILED', message: 'فشل فك ضغط الملف' }));
    worker.on('exit', () => done({ ok: false, code: 'FAILED', message: 'فشل فك ضغط الملف' }));
  });
}

// Walk extracted tree: drop symlinks/special files, count real size, enforce limit.
async function sanitizeTree(dir, state) {
  const items = await fs.readdir(dir);
  for (const name of items) {
    const full = path.join(dir, name);
    const st = await fs.lstat(full);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) {
      await fs.remove(full);
    } else if (st.isDirectory()) {
      await sanitizeTree(full, state);
    } else {
      state.bytes += st.size;
      state.files += 1;
      if (state.bytes > state.maxBytes) return;
    }
    if (state.bytes > state.maxBytes) return;
  }
}

/**
 * @param {string} archivePath absolute path of the archive
 * @param {string} destDir     absolute destination directory (must exist)
 * @param {string} tmpBase     absolute directory for temporary work
 * @param {object} opts        { maxBytes, password }
 * @returns {Promise<{count:number}|{error:string, code?:string}>}
 */
async function extractArchive(archivePath, destDir, tmpBase, opts = {}) {
  const maxBytes = opts.maxBytes || 500 * 1024 * 1024;
  const workDir = path.join(tmpBase, `extract-${crypto.randomBytes(8).toString('hex')}`);
  // Keep the real file name: 7-Zip derives the output name (and .tgz -> .tar) from it.
  const archiveRel = 'in/' + (path.basename(archivePath).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'archive');
  try {
    await fs.ensureDir(path.join(workDir, 'in'));
    await fs.copy(archivePath, path.join(workDir, archiveRel));

    const res = await runWorker({
      workDir,
      archiveRel,
      password: opts.password ? String(opts.password) : '',
      maxBytes,
      maxFiles: MAX_FILES,
    });
    if (!res.ok) return { error: res.message, code: res.code };

    const outDir = path.join(workDir, res.outRel);
    const state = { bytes: 0, files: 0, maxBytes };
    await sanitizeTree(outDir, state);
    if (state.bytes > maxBytes) {
      return {
        error: `حجم المحتوى بعد فك الضغط أكبر من ${Math.round(maxBytes / 1024 / 1024)}MB`,
        code: 'TOO_BIG',
      };
    }
    if (!state.files) return { error: 'الأرشيف فاضي', code: 'EMPTY' };

    // A lone compressed file (e.g. data.json.gz) comes out named after the
    // archive minus extension, which is what we want — just merge it in.
    await fs.copy(outDir, destDir, { overwrite: true, dereference: false });
    return { count: state.files };
  } catch (err) {
    console.error('extractArchive error:', err);
    return { error: 'فشل فك ضغط الملف', code: 'FAILED' };
  } finally {
    fs.remove(workDir).catch(() => {});
  }
}

module.exports = { extractArchive, isArchiveName, ARCHIVE_EXTS };
