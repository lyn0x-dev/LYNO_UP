'use strict';
// كاتب tar.gz بسيط (streaming) — بيتستخدم في ضغط الملفات
const path = require('path');
const zlib = require('zlib');
const fs = require('fs-extra');
const { safePath } = require('./utils');

// Minimal streaming tar writer (ustar + GNU long names), gzip-compressed on the fly
function tarHeader(name, size, mode, mtime, type) {
  const buf = Buffer.alloc(512);
  let nameBuf = Buffer.from(name, 'utf8');
  let prefix = '';
  if (nameBuf.length > 100) {
    // split at a slash so name<=100 and prefix<=155 (ustar)
    const idx = name.lastIndexOf('/', 155);
    const rest = idx > 0 ? name.slice(idx + 1) : '';
    if (idx > 0 && Buffer.byteLength(rest) <= 100) { prefix = name.slice(0, idx); nameBuf = Buffer.from(rest, 'utf8'); }
    else nameBuf = nameBuf.subarray(0, 100);
  }
  nameBuf.copy(buf, 0);
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100);
  buf.write('0000000\0', 108);
  buf.write('0000000\0', 116);
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124);
  buf.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136);
  buf.write('        ', 148);
  buf.write(type, 156);
  buf.write('ustar\0' + '00', 257);
  if (prefix) buf.write(prefix, 345);
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return buf;
}

async function createTarGz(botPath, relPaths, destAbs) {
  const gz = zlib.createGzip({ level: 6 });
  const out = fs.createWriteStream(destAbs);
  const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); gz.on('error', reject); });
  gz.pipe(out);
  const write = (chunk) => new Promise((resolve, reject) => {
    gz.write(chunk, err => (err ? reject(err) : resolve()));
  });
  let added = 0;
  const addEntry = async (abs, rel) => {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      await write(tarHeader(rel.replace(/\/+$/, '') + '/', 0, 0o755, st.mtimeMs, '5'));
      for (const child of await fs.readdir(abs)) await addEntry(path.join(abs, child), `${rel}/${child}`);
      return;
    }
    if (!st.isFile()) return;
    await write(tarHeader(rel, st.size, 0o644, st.mtimeMs, '0'));
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(abs);
      rs.on('data', (chunk) => { if (!gz.write(chunk)) { rs.pause(); gz.once('drain', () => rs.resume()); } });
      rs.on('end', resolve);
      rs.on('error', reject);
    });
    const pad = (512 - (st.size % 512)) % 512;
    if (pad) await write(Buffer.alloc(pad));
    added += 1;
  };
  try {
    for (const rel of relPaths) {
      const abs = safePath(botPath, rel.split('/').join(path.sep));
      if (!abs || !await fs.pathExists(abs)) continue;
      if (path.resolve(abs) === path.resolve(destAbs)) continue;
      await addEntry(abs, rel);
    }
    await write(Buffer.alloc(1024));
    gz.end();
    await done;
  } catch (err) {
    gz.destroy();
    await fs.remove(destAbs).catch(() => {});
    throw err;
  }
  return added;
}

module.exports = { createTarGz };
