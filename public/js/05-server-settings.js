// ====== Startup ======
function renderStartup() {
  if (!state.currentBot) return;
  const bot = state.currentBot;
  $('#startup-name').value = bot.name || '';
  $('#startup-mainfile').value = bot.mainFile || 'index.js';
  $('#startup-description').value = bot.description || '';
  $('#startup-env').value = JSON.stringify(bot.env || {}, null, 2);
  $('#startup-autorestart').checked = bot.autoRestart !== false;
}

$('#btn-save-startup').addEventListener('click', async () => {
  if (!state.currentBot) return;
  let envObj;
  try {
    const raw = $('#startup-env').value.trim();
    envObj = raw ? JSON.parse(raw) : {};
  } catch (_) {
    toast('متغيرات البيئة لازم تكون JSON صالح', 'error');
    return;
  }
  try {
    const data = await api(`/api/bots/${state.currentBot.id}`, {
      method: 'PUT',
      body: {
        name: $('#startup-name').value,
        mainFile: $('#startup-mainfile').value,
        description: $('#startup-description').value,
        env: envObj,
        autoRestart: $('#startup-autorestart').checked,
      },
    });
    state.currentBot = { ...state.currentBot, ...data.bot };
    $('#server-name').textContent = data.bot.name;
    $('#breadcrumb').textContent = data.bot.name;
    toast('تم حفظ الإعدادات');
    loadBots();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ====== Server access credentials ======
function panelBase() {
  return (state.panelUrl || location.origin).replace(/\/+$/, '');
}
function serverLink(botId) {
  return `${panelBase()}/?server=${encodeURIComponent(botId)}`;
}
function accountLink(username) {
  return `${panelBase()}/?u=${encodeURIComponent(username)}`;
}

function renderCredentials(creds) {
  if (!creds) return;
  $('#cred-link').textContent = state.currentBot ? serverLink(state.currentBot.id) : '—';
  $('#cred-username').textContent = creds.username;
  $('#cred-password').textContent = creds.password;
  $('#cred-pass-row').style.display = '';
  state.shownPass = { botId: state.currentBot ? state.currentBot.id : null, username: creds.username, password: creds.password };
}

async function loadCredentials() {
  const card = $('#creds-card');
  if (!state.currentBot) return;
  if (state.isServer) { card.style.display = 'none'; return; }
  card.style.display = '';
  $('#cred-link').textContent = serverLink(state.currentBot.id);
  try {
    const data = await api(`/api/bots/${state.currentBot.id}/credentials`);
    const uname = data.username || '—';
    const shown = state.shownPass;
    const keepPass = shown && shown.botId === state.currentBot.id && shown.username === uname;
    $('#cred-username').textContent = uname;
    if (data.password) {
      $('#cred-password').textContent = data.password;
      $('#cred-pass-row').style.display = '';
    } else if (keepPass) {
      $('#cred-password').textContent = shown.password;
      $('#cred-pass-row').style.display = '';
    } else {
      $('#cred-pass-row').style.display = 'none';
    }
  } catch (_) {
    $('#cred-username').textContent = '—';
    $('#cred-pass-row').style.display = 'none';
  }
}

$('#btn-copy-cred').addEventListener('click', () => {
  const link = $('#cred-link').textContent;
  const u = $('#cred-username').textContent;
  const hasPass = $('#cred-pass-row').style.display !== 'none';
  const text = hasPass
    ? `رابط السيرفر: ${link}\nusername: ${u}\npassword: ${$('#cred-password').textContent}`
    : `رابط السيرفر: ${link}\nusername: ${u}`;
  if (!navigator.clipboard) { toast('النسخ غير مدعوم في المتصفح', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => toast('تم النسخ'), () => toast('تعذّر النسخ', 'error'));
});

$('#btn-regen-cred').addEventListener('click', async () => {
  if (!state.currentBot) return;
  if (!confirm('توليد بيانات دخول جديدة؟ البيانات القديمة هتبطل فوراً.')) return;
  try {
    const data = await api(`/api/bots/${state.currentBot.id}/credentials`, { method: 'POST' });
    renderCredentials(data.credentials);
    toast('تم توليد بيانات دخول جديدة');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#btn-delete-server').addEventListener('click', async () => {
  if (!state.currentBot) return;
  if (!confirm(`تأكيد حذف السيرفر "${state.currentBot.name}" وكل ملفاته نهائياً؟`)) return;
  try {
    await api(`/api/bots/${state.currentBot.id}`, { method: 'DELETE' });
    toast('تم حذف السيرفر');
    state.currentBot = null;
    switchPage('dashboard');
    loadBots();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ====== New Server Modal ======
const modalNewServer = $('#modal-new-server');

function openModal(modal) { modal.classList.add('open'); }
function closeModal(modal) { modal.classList.remove('open'); }

$('#btn-new-server').addEventListener('click', () => {
  $('#form-new-server').reset();
  $('#file-preview').innerHTML = '';
  selectedFiles = [];
  openModal(modalNewServer);
});
$$('#modal-new-server .modal-close, #modal-new-server .modal-close-btn, #modal-new-server .modal-backdrop')
  .forEach(el => el.addEventListener('click', () => closeModal(modalNewServer)));

let selectedFiles = [];
const dropzone = $('#dropzone');
const fileInput = $('#server-file-input');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => addFiles(fileInput.files));

function addFiles(fileList) {
  for (const f of fileList) selectedFiles.push(f);
  fileInput.value = '';
  renderFilePreview();
}

function renderFilePreview() {
  $('#file-preview').innerHTML = selectedFiles.map((f, i) => `
    <div class="file-preview-item">
      <span>📄</span>
      <span class="fp-name">${esc(f.name)}</span>
      <span class="fp-size">${fmtBytes(f.size)}</span>
      <button type="button" class="mini-btn" data-rm="${i}" title="إزالة">✕</button>
    </div>`).join('');
  $$('#file-preview [data-rm]').forEach(btn => btn.addEventListener('click', () => {
    selectedFiles.splice(Number(btn.dataset.rm), 1);
    renderFilePreview();
  }));
}

$('#form-new-server').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData();
  fd.append('name', form.name.value);
  fd.append('mainFile', form.mainFile.value || 'index.js');
  fd.append('env', form.env.value || '');
  const firstFile = selectedFiles[0];

  const submitBtn = $('button[type="submit"]', form);
  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري الإنشاء...';
  try {
    const data = firstFile
      ? await uploadFile('/api/bots', firstFile, { name: form.name.value, mainFile: form.mainFile.value || 'index.js', env: form.env.value || '' },
          (p) => { submitBtn.textContent = `جاري الرفع ${p}%`; })
      : await api('/api/bots', { method: 'POST', body: fd });
    const newBot = data.bot;
    const failed = [];
    for (let i = 1; i < selectedFiles.length; i += 1) {
      submitBtn.textContent = `جاري رفع الملفات (${i}/${selectedFiles.length - 1})`;
      try { await uploadFile(`/api/bots/${newBot.id}/upload`, selectedFiles[i], {}); } catch (_) { failed.push(selectedFiles[i].name); }
    }
    if (failed.length) toast(`فشل رفع: ${failed.join(', ')}`, 'error');
    toast('تم إنشاء السيرفر');
    closeModal(modalNewServer);
    selectedFiles = [];
    await loadBots();
    await openServer(newBot.id);
    if (data.credentials) {
      renderCredentials(data.credentials);
      toast('نسخ بيانات الدخول من تبويب "الإعدادات"', 'success');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'إنشاء السيرفر';
  }
});
