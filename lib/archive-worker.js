'use strict';
// Runs inside a worker thread: lists, validates and extracts any archive that
// 7-Zip understands (zip, rar, 7z, tar, gz, bz2, xz, iso, cab, ...), using the
// WASM build so no system binaries are required.
const { parentPort, workerData } = require('worker_threads');

const { workDir, archiveRel, password, maxBytes, maxFiles } = workerData;
const MAX_PASSES = 4; // e.g. .tar.gz -> .tar -> files

function fail(code, message) {
  parentPort.postMessage({ ok: false, code, message });
}

function parseListing(lines) {
  // `7z l -slt -ba` prints blocks of "Key = Value" separated by blank lines.
  // Single-stream formats (.gz/.bz2/.xz) have no "Path" key, so a block counts
  // as an entry as soon as it has a Path or a Size.
  const entries = [];
  let cur = null;
  const flush = () => {
    if (cur && ('Path' in cur || 'Size' in cur)) entries.push(cur);
    cur = null;
  };
  for (const raw of lines) {
    const line = String(raw).replace(/[\x00-\x08\x0b-\x1f]/g, '');
    if (!line.trim()) { flush(); continue; }
    const m = line.match(/^([A-Za-z][A-Za-z ]*?) = ?(.*)$/);
    if (!m) continue;
    if (!cur) cur = {};
    cur[m[1]] = m[2];
  }
  flush();
  return entries;
}

function isSafeEntryPath(p) {
  if (p === undefined || p === '') return true; // single-stream formats: name is implicit
  if (typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return false;
  const parts = norm.split('/').filter(x => x && x !== '.');
  return parts.length > 0 && !parts.includes('..');
}

(async () => {
  let SevenZip;
  try {
    SevenZip = require('7z-wasm');
  } catch (_) {
    return fail('ENGINE_MISSING', 'مكتبة 7z-wasm غير منصّبة — شغّل npm install');
  }

  let sink = [];
  let sz;
  try {
    sz = await SevenZip({
      print: s => sink.push(String(s)),
      printErr: s => sink.push(String(s)),
    });
  } catch (_) {
    return fail('ENGINE_FAILED', 'تعذّر تشغيل محرك فك الضغط');
  }

  sz.FS.mkdir('/work');
  sz.FS.mount(sz.NODEFS, { root: workDir }, '/work');

  const pw = `-p${password || 'x-no-password-x'}`;

  function run(args) {
    sink = [];
    let code = 0;
    try {
      const r = sz.callMain(args);
      if (typeof r === 'number') code = r;
    } catch (e) {
      code = e && typeof e.status === 'number' ? e.status : 2;
    }
    return { code, out: sink.join('\n') };
  }

  function explain(out) {
    if (/Wrong password|Data Error in encrypted file|ERROR: .*password/i.test(out)) {
      return ['BAD_PASSWORD', 'كلمة مرور الأرشيف غير صحيحة'];
    }
    if (/Cannot open|Can not open|not archive|Unsupported Method|Is not supported archive/i.test(out)) {
      return ['UNSUPPORTED', 'الصيغة غير مدعومة أو الملف ليس أرشيفاً صالحاً'];
    }
    if (/Headers Error|Unexpected end|CRC Failed|Data Error|corrupt/i.test(out)) {
      return ['CORRUPT', 'الأرشيف تالف أو ناقص'];
    }
    return ['FAILED', 'فشل فك الضغط'];
  }

  let current = '/work/' + archiveRel;
  let totalFiles = 0;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    // ---- 1. List & validate before writing anything ----
    const listed = run(['l', '-slt', '-ba', '-bd', pw, current]);
    const entries = parseListing(listed.out.split(/\r?\n/));
    if (!entries.length) {
      const [code, msg] = explain(listed.out);
      return fail(code === 'FAILED' ? 'UNSUPPORTED' : code, msg);
    }
    if (entries.some(e => e.Encrypted === '+') && !password) {
      return fail('PASSWORD_REQUIRED', 'الأرشيف محمي بكلمة مرور');
    }
    if (entries.length > maxFiles) {
      return fail('TOO_MANY', 'عدد الملفات داخل الأرشيف كبير جداً');
    }
    let declared = 0;
    for (const e of entries) {
      if (!isSafeEntryPath(e.Path)) {
        return fail('UNSAFE', 'الأرشيف يحتوي على مسارات غير آمنة (خروج عن المجلد)');
      }
      const n = parseInt(e.Size, 10);
      if (Number.isFinite(n) && n > 0) declared += n;
    }
    if (declared > maxBytes) {
      return fail('TOO_BIG', `حجم المحتوى بعد فك الضغط أكبر من ${Math.round(maxBytes / 1024 / 1024)}MB`);
    }

    // ---- 2. Extract ----
    const outRel = `out${pass}`;
    const outAbs = `/work/${outRel}`;
    sz.FS.mkdir(outAbs);
    const res = run(['x', '-y', '-bd', '-aoa', pw, `-o${outAbs}`, current]);
    if (res.code !== 0 && res.code !== 1) { // 1 = warning (e.g. a skipped entry)
      const [code, msg] = explain(res.out);
      return fail(code, msg);
    }
    totalFiles += entries.filter(e => e.Folder !== '+').length;

    // ---- 3. Single .tar inside (from .tar.gz/.tgz/.tar.xz/...) -> go again ----
    const names = sz.FS.readdir(outAbs).filter(n => n !== '.' && n !== '..');
    if (names.length === 1 && /\.tar$/i.test(names[0])) {
      const st = sz.FS.stat(`${outAbs}/${names[0]}`);
      if (!sz.FS.isDir(st.mode)) {
        current = `${outAbs}/${names[0]}`;
        continue;
      }
    }
    return parentPort.postMessage({ ok: true, outRel, count: totalFiles });
  }
  return fail('TOO_DEEP', 'الأرشيف متداخل أكثر من اللازم');
})().catch(err => fail('FAILED', String((err && err.message) || err)));
