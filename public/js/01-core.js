'use strict';

// ====== State ======
const state = {
  user: null,
  isAdmin: false,
  isServer: false,
  canCreate: true,
  bots: [],
  currentBot: null,
  currentDir: '',
  currentFiles: [],
  editingFile: null,
  ws: null,
  search: '',
  users: [],
  shownPass: null,
  panelUrl: '',
  pendingServer: null,
  botStats: {},
};

function roleLabel(role) {
  if (role === 'admin') return 'مشرف';
  if (role === 'server') return 'حساب سيرفر';
  return 'مستخدم';
}

// ====== Helpers ======
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} يوم ${h} س`;
  if (h > 0) return `${h} س ${m} د`;
  return `${m} دقيقة`;
}

function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

const encodePath = (p) => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');

// Session token fallback (some mobile browsers drop/ignore cookies, esp. with mixed http/https)
const TOKEN_KEY = 'panel_token';
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } }
function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignore */ } }

function authHeaders(extra) {
  const h = { ...(extra || {}) };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

// A 401 is only treated as "logged out" if /api/auth/me confirms it (a single stray 401 must not kick the user out mid-upload)
async function sessionReallyExpired() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin', headers: authHeaders(), cache: 'no-store' });
    if (!res.ok) return false;
    const d = await res.json();
    return !d.authenticated;
  } catch (_) { return false; }
}

// Archive formats that get an "extract" option (the server detects the real format by content)
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|tbz2?|xz|txz|lzma|z|lz|cab|iso|arj|cpio|rpm|deb|wim|jar|war|apk|whl|vhd|dmg)$/i;

async function api(url, options = {}) {
  const opts = { credentials: 'same-origin', cache: 'no-store', ...options };
  opts.headers = authHeaders(opts.headers);
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
    opts.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (_) {
    throw new Error('تعذر الاتصال بالخادم، تأكد من الإنترنت وحاول تاني');
  }
  const fresh = res.headers.get('X-Session-Token');
  if (fresh) setToken(fresh);
  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }
  if (res.status === 401 && !url.includes('/api/auth/')) {
    if (await sessionReallyExpired()) {
      handleLogout();
      throw new Error('انتهت الجلسة');
    }
    throw new Error('تعذر التحقق من الجلسة، حاول تاني');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `خطأ ${res.status}`);
  }
  return data;
}

// Upload a file with progress, no timeout, and one automatic retry (copies the file into memory,
// which fixes Android "content://" / cloud-drive files that fail to stream the first time)
function uploadOnce(url, file, extra, onProgress, inMemory) {
  return new Promise(async (resolve, reject) => {
    let blob = file;
    if (inMemory) {
      try { blob = new File([await file.arrayBuffer()], file.name, { type: file.type }); }
      catch (_) { return reject(new Error('تعذر قراءة الملف من الجهاز')); }
    }
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra || {})) if (v) fd.append(k, v);
    fd.append('file', blob, file.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    const t = getToken();
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.timeout = 0;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(Object.assign(new Error('انقطع الاتصال أثناء الرفع'), { network: true }));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = xhr.onerror;
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) { /* ignore */ }
      const fresh = xhr.getResponseHeader('X-Session-Token');
      if (fresh) setToken(fresh);
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error((data && data.error) || `فشل الرفع (${xhr.status})`);
      err.status = xhr.status;
      reject(err);
    };
    xhr.send(fd);
  });
}

async function uploadFile(url, file, extra, onProgress) {
  const attempt = async (mem) => {
    try { return await uploadOnce(url, file, extra, onProgress, mem); }
    catch (err) {
      if (err.status === 401) {
        if (await sessionReallyExpired()) { handleLogout(); throw new Error('انتهت الجلسة'); }
        err.retry = true;
      }
      if (err.network || err.retry) throw Object.assign(err, { retry: true });
      throw err;
    }
  };
  try { return await attempt(false); }
  catch (err) {
    if (!err.retry) throw err;
    await new Promise(r => setTimeout(r, 800));
    return attempt(true);
  }
}

// ====== Toast ======
function toast(message, type = 'success') {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'error' ? '✕' : '✓';
  el.innerHTML = `<span class="t-icon">${icon}</span><span>${esc(message)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 320);
  }, 3200);
}
