// ====== Files ======
async function loadFiles(dir) {
  if (!state.currentBot) return;
  state.currentDir = dir || '';
  closeEditor();
  const listEl = $('#file-list');
  listEl.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto"></div></div>';
  renderBreadcrumb();
  try {
    const pathPart = state.currentDir ? `/${encodePath(state.currentDir)}` : '';
    const data = await api(`/api/bots/${state.currentBot.id}/files${pathPart}`);
    state.currentFiles = Array.isArray(data) ? data : [];
    renderFiles(state.currentFiles);
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state"><div class="es-sub">${esc(err.message)}</div></div>`;
  }
}

function fileIcon(name, isDir) {
  if (isDir) return '📁';
  if (/\.zip$/i.test(name)) return '🗜️';
  if (/\.(js|mjs|cjs|ts)$/i.test(name)) return '📜';
  if (/\.json$/i.test(name)) return '⚙️';
  if (/\.env/i.test(name)) return '🔑';
  if (/\.(md|txt)$/i.test(name)) return '📝';
  if (/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(name)) return '🖼️';
  return '📄';
}

function renderBreadcrumb() {
  const crumbs = $('#file-breadcrumb');
  const parts = state.currentDir ? state.currentDir.split('/').filter(Boolean) : [];
  let html = `<span class="crumb" data-path="">/ container</span>`;
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    html += ` <span class="sep">/</span> <span class="crumb" data-path="${esc(acc)}">${esc(part)}</span>`;
  }
  crumbs.innerHTML = html;
  $$('.crumb', crumbs).forEach(c => c.addEventListener('click', () => loadFiles(c.dataset.path)));
}

function renderFiles(files) {
  const listEl = $('#file-list');
  if (!files.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="es-icon">📂</div><div class="es-sub">المجلد فاضي</div></div>';
    return;
  }
  files.sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
  listEl.innerHTML = files.map(f => {
    const full = state.currentDir ? `${state.currentDir}/${f.name}` : f.name;
    return `
      <div class="file-row" data-path="${esc(full)}" data-dir="${f.isDirectory}">
        <span class="f-icon">${fileIcon(f.name, f.isDirectory)}</span>
        <span class="f-name ${f.isDirectory ? 'dir' : ''}">${esc(f.name)}</span>
        <span class="f-size">${f.isDirectory ? '' : fmtBytes(f.size)}</span>
        <button class="dots-btn" data-act="menu" aria-label="خيارات" title="خيارات">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
        </button>
      </div>`;
  }).join('');

  $$('.file-row', listEl).forEach(row => {
    const path = row.dataset.path;
    const isDir = row.dataset.dir === 'true';
    $('.f-name', row).addEventListener('click', () => {
      if (isDir) loadFiles(path);
      else openFile(path);
    });
    $('[data-act="menu"]', row).addEventListener('click', (e) => {
      e.stopPropagation();
      openFileMenu(path, isDir, e.currentTarget);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openFileMenu(path, isDir, null, e.clientX, e.clientY);
    });
    // Long-press (touch) opens the same menu
    let timer = null; let sx = 0; let sy = 0; let fired = false;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    row.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      fired = false;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      cancel();
      timer = setTimeout(() => {
        fired = true;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* ignore */ } }
        openFileMenu(path, isDir, null, sx, sy);
      }, 480);
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) cancel();
    }, { passive: true });
    row.addEventListener('touchend', (e) => { cancel(); if (fired) { e.preventDefault(); fired = false; } });
    row.addEventListener('touchcancel', cancel);
  });
}

// ====== File context menu (⋮ button, right-click, long-press) ======
function closeFileMenu() {
  const m = $('#file-menu-wrap');
  if (m) m.remove();
  document.removeEventListener('keydown', menuKeyHandler);
}
function menuKeyHandler(e) { if (e.key === 'Escape') closeFileMenu(); }

function openFileMenu(path, isDir, anchorEl, x, y) {
  closeFileMenu();
  const name = path.split('/').pop();
  const items = [];
  if (!isDir) items.push({ icon: '✎', label: 'تعديل', fn: () => openFile(path) });
  items.push({ icon: '✏️', label: 'إعادة تسمية', fn: () => renamePath(path) });
  items.push({ icon: '⬇', label: isDir ? 'تنزيل (zip)' : 'تنزيل', fn: () => downloadPath(path) });
  items.push({ sep: true });
  items.push({ icon: '🗜️', label: 'ضغط ZIP', fn: () => compressPaths([path], 'zip') });
  items.push({ icon: '🗜️', label: 'ضغط TAR.GZ', fn: () => compressPaths([path], 'tar.gz') });
  // Shown on every file: the server detects the real archive format by content (not just the extension)
  if (!isDir) items.push({ icon: '📦', label: 'فك الضغط', fn: () => extractArchive(path) });
  items.push({ sep: true });
  items.push({ icon: '🗑', label: 'حذف', danger: true, fn: () => deleteFile(path) });

  const wrap = document.createElement('div');
  wrap.id = 'file-menu-wrap';
  wrap.className = 'fmenu-wrap';
  wrap.innerHTML = `
    <div class="fmenu-backdrop"></div>
    <div class="fmenu" role="menu">
      <div class="fmenu-title">${esc(name)}</div>
      ${items.map((it, i) => it.sep ? '<div class="fmenu-sep"></div>'
        : `<button class="fmenu-item ${it.danger ? 'danger' : ''}" role="menuitem" data-i="${i}"><span class="fmenu-ic">${it.icon}</span><span>${esc(it.label)}</span></button>`).join('')}
    </div>`;
  document.body.appendChild(wrap);

  $('.fmenu-backdrop', wrap).addEventListener('click', closeFileMenu);
  $('.fmenu-backdrop', wrap).addEventListener('contextmenu', (e) => { e.preventDefault(); closeFileMenu(); });
  $$('.fmenu-item', wrap).forEach(btn => btn.addEventListener('click', () => {
    const it = items[Number(btn.dataset.i)];
    closeFileMenu();
    it.fn();
  }));
  document.addEventListener('keydown', menuKeyHandler);

  // Desktop: popover next to the button / cursor. Phones: bottom sheet (CSS).
  const menu = $('.fmenu', wrap);
  if (window.innerWidth > 640) {
    let px = x; let py = y;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      px = r.left; py = r.bottom + 4;
    }
    const mw = menu.offsetWidth; const mh = menu.offsetHeight;
    px = Math.max(8, Math.min(px, window.innerWidth - mw - 8));
    if (py + mh > window.innerHeight - 8) py = Math.max(8, (anchorEl ? anchorEl.getBoundingClientRect().top - mh - 4 : y - mh));
    menu.style.left = `${px}px`;
    menu.style.top = `${py}px`;
  } else {
    menu.classList.add('sheet');
  }
}

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

async function mkdirPath() {
  const name = prompt('اسم المجلد الجديد:');
  if (!name) return;
  if (/[\\/]/.test(name.trim())) { toast('الاسم مينفعش يحتوي على /', 'error'); return; }
  try {
    await api(`/api/bots/${state.currentBot.id}/mkdir`, { method: 'POST', body: { path: joinPath(state.currentDir, name.trim()) } });
    toast('تم إنشاء المجلد');
    loadFiles(state.currentDir);
  } catch (err) { toast(err.message, 'error'); }
}

async function newFilePath() {
  const name = prompt('اسم الملف الجديد:');
  if (!name) return;
  if (/[\\/]/.test(name.trim())) { toast('الاسم مينفعش يحتوي على /', 'error'); return; }
  const full = joinPath(state.currentDir, name.trim());
  try {
    await api(`/api/bots/${state.currentBot.id}/newfile`, { method: 'POST', body: { path: full, content: '' } });
    toast('تم إنشاء الملف');
    await loadFiles(state.currentDir);
    openFile(full);
  } catch (err) { toast(err.message, 'error'); }
}

async function renamePath(path) {
  const oldName = path.split('/').pop();
  const name = prompt('الاسم الجديد:', oldName);
  if (!name || name.trim() === oldName) return;
  if (/[\\/]/.test(name.trim())) { toast('الاسم مينفعش يحتوي على /', 'error'); return; }
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  try {
    await api(`/api/bots/${state.currentBot.id}/rename`, { method: 'POST', body: { from: path, to: joinPath(dir, name.trim()) } });
    toast('تم إعادة التسمية');
    loadFiles(state.currentDir);
  } catch (err) { toast(err.message, 'error'); }
}

function downloadPath(path) {
  const url = `/api/bots/${state.currentBot.id}/download/${encodePath(path)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function compressPaths(paths, format = 'zip', baseName) {
  const ext = format === 'tar.gz' ? '.tar.gz' : '.zip';
  const base = (baseName || paths[0].split('/').pop()).replace(/\.(zip|tar\.gz|tgz)$/i, '');
  let dest = prompt(`اسم ملف الأرشيف (${ext}):`, `${base}${ext}`);
  if (!dest) return;
  dest = dest.trim().replace(/\.(zip|tar\.gz|tgz)$/i, '') + ext;
  if (/[\\/]/.test(dest)) { toast('الاسم مينفعش يحتوي على /', 'error'); return; }
  const dir = state.currentDir;
  toast('جاري الضغط...');
  try {
    const r = await api(`/api/bots/${state.currentBot.id}/archive`, { method: 'POST', body: { paths, dest: joinPath(dir, dest), format } });
    toast(`تم إنشاء الأرشيف (${r.count} ملف)`);
    loadFiles(dir);
  } catch (err) { toast(err.message, 'error'); }
}

async function extractArchive(path, password) {
  if (password === undefined && !confirm(`فك ضغط "${path}" في نفس المجلد؟`)) return;
  toast('جاري فك الضغط...');
  try {
    const r = await api(`/api/bots/${state.currentBot.id}/extract`, { method: 'POST', body: { file: path, password: password || '' } });
    toast(`تم فك الضغط (${r.extracted} ملف)`);
    loadFiles(state.currentDir);
  } catch (err) {
    if (err.code === 'PASSWORD_REQUIRED' || err.code === 'BAD_PASSWORD') {
      const pw = prompt(err.code === 'BAD_PASSWORD' ? 'كلمة المرور غلط، جرّب تاني:' : 'الأرشيف محمي بكلمة مرور، اكتبها:');
      if (pw) return extractArchive(path, pw);
      return;
    }
    toast(err.message, 'error');
  }
}

async function openFile(path) {
  try {
    const data = await api(`/api/bots/${state.currentBot.id}/files/${encodePath(path)}`);
    if (Array.isArray(data)) {
      loadFiles(path);
      return;
    }
    state.editingFile = path;
    $('#editor-filename').textContent = path;
    $('#editor-content').value = data.content;
    $('#file-editor').style.display = 'block';
    $('#file-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function closeEditor() {
  state.editingFile = null;
  $('#file-editor').style.display = 'none';
  $('#editor-content').value = '';
}

$('#btn-close-editor').addEventListener('click', closeEditor);

$('#btn-save-file').addEventListener('click', async () => {
  if (!state.editingFile) return;
  try {
    await api(`/api/bots/${state.currentBot.id}/files/${encodePath(state.editingFile)}`, {
      method: 'PUT',
      body: { content: $('#editor-content').value },
    });
    toast('تم حفظ الملف');
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function deleteFile(path) {
  if (!confirm(`تأكيد حذف: ${path} ؟`)) return;
  try {
    await api(`/api/bots/${state.currentBot.id}/files/${encodePath(path)}`, { method: 'DELETE' });
    toast('تم الحذف');
    if (state.editingFile === path) closeEditor();
    loadFiles(state.currentDir);
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#btn-refresh-files').addEventListener('click', () => loadFiles(state.currentDir));
$('#btn-new-folder').addEventListener('click', mkdirPath);
$('#btn-new-file').addEventListener('click', newFilePath);
$('#btn-compress-folder').addEventListener('click', () => {
  if (!state.currentFiles.length) { toast('المجلد فاضي', 'error'); return; }
  const paths = state.currentFiles.map(f => joinPath(state.currentDir, f.name));
  compressPaths(paths, 'zip', (state.currentDir ? state.currentDir.split('/').pop() : (state.currentBot && state.currentBot.name) || 'archive').replace(/[^\w.\-]+/g, '_'));
});
$('#btn-install-deps').addEventListener('click', installDeps);

async function installDeps() {
  if (!state.currentBot) return;
  const input = prompt('أسماء المكتبات (مسافات أو فواصل بينهم).\nسيبه فاضي لتنصيب اللي في package.json:', '');
  if (input === null) return;
  const packages = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const btn = $('#btn-install-deps');
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'جاري التنصيب...';
  toast('بدأ تنصيب المكتبات، تابِع الكونسول للمخرجات');
  try {
    const r = await api(`/api/bots/${state.currentBot.id}/install`, { method: 'POST', body: { packages } });
    toast(r.success ? 'تم تنصيب المكتبات بنجاح' : 'تنصيب المكتبات فشل - شوف الكونسول', r.success ? 'success' : 'error');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// Upload into current dir (input lives in the DOM: detached inputs lose their change event on mobile browsers)
const uploadInput = document.createElement('input');
uploadInput.type = 'file';
uploadInput.multiple = true;
uploadInput.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
document.body.appendChild(uploadInput);

uploadInput.addEventListener('change', async () => {
  const files = Array.from(uploadInput.files || []);
  const bot = state.currentBot;
  const dir = state.currentDir;
  if (!files.length || !bot) return;
  const btn = $('#btn-upload');
  const oldLabel = btn.textContent;
  btn.disabled = true;
  let ok = 0;
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : '';
    try {
      await uploadFile(`/api/bots/${bot.id}/upload`, f, { path: dir }, (p) => { btn.textContent = `${prefix}${p}%`; });
      ok += 1;
    } catch (err) {
      toast(`${f.name}: ${err.message}`, 'error');
      if (err.message === 'انتهت الجلسة') break;
    }
  }
  btn.disabled = false;
  btn.textContent = oldLabel;
  uploadInput.value = '';
  if (ok) {
    toast(ok > 1 ? `تم رفع ${ok} ملفات` : 'تم رفع الملف');
    if (state.currentBot && state.currentBot.id === bot.id) loadFiles(state.currentDir);
  }
});

$('#btn-upload').addEventListener('click', () => {
  uploadInput.value = '';
  uploadInput.click();
});
