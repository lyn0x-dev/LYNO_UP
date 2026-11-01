// ====== Users (Admin) ======
async function loadUsers() {
  try {
    state.users = await api('/api/users');
    renderUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderUsers() {
  const body = $('#users-table-body');
  if (!state.users.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="es-sub">مفيش مستخدمين</div></div></td></tr>';
    return;
  }
  body.innerHTML = state.users.map(u => `
    <tr data-id="${u.id}">
      <td data-label="المستخدم">
        <div class="cell-user">
          <div class="cell-avatar">${esc(u.username.charAt(0).toUpperCase())}</div>
          <span class="cu-name">${esc(u.username)}${u.id === state.user.id ? ' <span style="color:var(--text-mute);font-size:11px">(أنت)</span>' : ''}</span>
        </div>
      </td>
      <td data-label="الصلاحية"><span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}">${u.role === 'admin' ? 'مشرف' : 'مستخدم'}</span></td>
      <td data-label="السيرفرات">${u.serverCount}</td>
      <td data-label="الحد الأقصى">${u.maxBots > 0 ? u.maxBots : '∞'}</td>
      <td data-label="الحالة"><span class="badge ${u.suspended ? 'badge-suspended' : 'badge-active'}">${u.suspended ? 'موقوف' : 'نشط'}</span></td>
      <td data-label="إجراءات">
        <div class="row-actions">
          <button class="mini-btn" data-act="link" title="نسخ الرابط">🔗</button>
          <button class="mini-btn" data-act="reset" title="تصفير كلمة المرور">🔑</button>
          <button class="mini-btn" data-act="edit" title="تعديل">✎</button>
          <button class="mini-btn" data-act="toggle" title="${u.suspended ? 'تفعيل' : 'إيقاف'}">${u.suspended ? '✔' : '⏸'}</button>
          <button class="mini-btn" data-act="delete" title="حذف">🗑</button>
        </div>
      </td>
    </tr>`).join('');

  $$('#users-table-body tr[data-id]').forEach(row => {
    const u = state.users.find(x => x.id === row.dataset.id);
    $('[data-act="edit"]', row).addEventListener('click', () => openUserModal(u));
    $('[data-act="toggle"]', row).addEventListener('click', () => toggleSuspend(u));
    $('[data-act="link"]', row).addEventListener('click', () => copyAccountLink(u));
    $('[data-act="reset"]', row).addEventListener('click', () => resetUserPassword(u));
    $('[data-act="delete"]', row).addEventListener('click', () => deleteUser(u));
  });
}

const modalUser = $('#modal-user');
$('#btn-new-user').addEventListener('click', () => openUserModal(null));
$$('#modal-user .modal-close, #modal-user .modal-close-btn, #modal-user .modal-backdrop')
  .forEach(el => el.addEventListener('click', () => closeModal(modalUser)));

function openUserModal(user) {
  $('#form-user').reset();
  if (user) {
    $('#user-modal-title').textContent = 'تعديل مستخدم';
    $('#user-id').value = user.id;
    $('#user-username').value = user.username;
    $('#user-username').disabled = true;
    $('#user-role').value = user.role;
    $('#user-maxbots').value = user.maxBots;
    $('#user-password').required = false;
    $('#user-password-hint').textContent = '(اتركه فاضي لعدم التغيير)';
    $('#btn-gen-username').style.display = 'none';
  } else {
    $('#user-modal-title').textContent = 'مستخدم جديد';
    $('#user-id').value = '';
    $('#user-username').disabled = false;
    $('#user-username').value = '';
    $('#user-password').value = '';
    $('#user-password').required = false;
    $('#user-password-hint').textContent = '(اتركه فاضي للتوليد العشوائي)';
    $('#btn-gen-username').style.display = '';
  }
  openModal(modalUser);
}

$('#btn-gen-username').addEventListener('click', () => { $('#user-username').value = randomName(); });
$('#btn-gen-password').addEventListener('click', () => { $('#user-password').value = randomPass(); });

$('#form-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#user-id').value;
  const body = {
    role: $('#user-role').value,
    maxBots: parseInt($('#user-maxbots').value, 10) || 0,
  };
  const pwd = $('#user-password').value;
  if (pwd) body.password = pwd;

  try {
    if (id) {
      await api(`/api/users/${id}`, { method: 'PUT', body });
      toast('تم تحديث المستخدم');
    } else {
      const name = $('#user-username').value.trim();
      if (name) body.username = name;
      const r = await api('/api/users', { method: 'POST', body });
      toast('تم إنشاء المستخدم');
      showCredsModal('بيانات الحساب الجديد', accountLink(r.credentials.username), r.credentials.username, r.credentials.password);
    }
    closeModal(modalUser);
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function copyAccountLink(user) {
  const link = accountLink(user.username);
  try {
    await navigator.clipboard.writeText(link);
    toast('تم نسخ رابط الحساب');
  } catch (_) {
    showCredsModal('رابط الحساب', link, user.username, '(كلمة المرور مخفية)');
  }
}

async function resetUserPassword(user) {
  if (!confirm(`توليد كلمة مرور جديدة للحساب "${user.username}"؟`)) return;
  try {
    const r = await api(`/api/users/${user.id}/credentials`, { method: 'POST' });
    showCredsModal('كلمة مرور جديدة', accountLink(user.username), r.credentials.username, r.credentials.password);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function randomName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 10; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function randomPass() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let s = '';
  for (let i = 0; i < 14; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ====== Credentials Result Modal ======
const modalCreds = $('#modal-creds');
let credsModalData = { link: '', user: '', pass: '' };

function showCredsModal(title, link, user, pass) {
  credsModalData = { link, user, pass };
  $('#creds-modal-title').textContent = title;
  $('#cm-link').textContent = link || '—';
  $('#cm-link-row').style.display = link ? '' : 'none';
  $('#cm-user').textContent = user || '—';
  $('#cm-pass').textContent = pass || '—';
  openModal(modalCreds);
}

$$('#modal-creds .modal-close, #modal-creds .modal-backdrop')
  .forEach(el => el.addEventListener('click', () => closeModal(modalCreds)));

$('#cm-copy').addEventListener('click', () => {
  const { link, user, pass } = credsModalData;
  const text = `الرابط: ${link}\nاسم المستخدم: ${user}\nكلمة المرور: ${pass}`;
  if (!navigator.clipboard) { toast('النسخ غير مدعوم في المتصفح', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => toast('تم النسخ'), () => toast('تعذّر النسخ', 'error'));
});

async function toggleSuspend(user) {
  try {
    await api(`/api/users/${user.id}`, { method: 'PUT', body: { suspended: !user.suspended } });
    toast(user.suspended ? 'تم تفعيل الحساب' : 'تم إيقاف الحساب');
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteUser(user) {
  if (!confirm(`تأكيد حذف المستخدم "${user.username}" وكل سيرفراته؟`)) return;
  try {
    await api(`/api/users/${user.id}`, { method: 'DELETE' });
    toast('تم حذف المستخدم');
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ====== System ======
async function loadSystem() {
  try {
    const info = await api('/api/system');
    const items = [
      ['المنصة', info.platform],
      ['المعمارية', info.arch],
      ['إصدار Node', info.nodeVersion],
      ['عدد الأنوية', info.cpus],
      ['مدة التشغيل', fmtUptime(info.uptime)],
      ['الذاكرة الكلية', fmtBytes(info.totalMemory)],
      ['الذاكرة الحرة', fmtBytes(info.freeMemory)],
      ['سيرفرات شغالة', `${info.runningBots} / ${info.limits.maxRunningBots}`],
      ['ذاكرة كل سيرفر', `${info.limits.botMemoryMb} MB`],
      ['أقصى حجم رفع', `${info.limits.uploadMaxMb} MB`],
    ];
    if (info.userCount !== undefined) items.push(['عدد المستخدمين', info.userCount]);
    $('#system-grid').innerHTML = items.map(([k, v]) => `
      <div class="setting-item"><div class="si-label">${esc(k)}</div><div class="si-value">${esc(v)}</div></div>`).join('');
    $('#stat-memory').textContent = fmtBytes(info.freeMemory);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ====== Account ======
function renderAccount() {
  if (!state.user) return;
  const u = state.user;
  $('#profile-avatar').textContent = u.username.charAt(0).toUpperCase();
  $('#profile-name').textContent = u.username;
  $('#profile-role').textContent = roleLabel(u.role);
  const limitText = u.role === 'server'
    ? 'مرتبط بسيرفر واحد'
    : (u.maxBots > 0 ? String(u.maxBots) : 'غير محدود');
  $('#profile-meta').innerHTML = `
    تاريخ الإنشاء: ${new Date(u.createdAt).toLocaleDateString('en-GB')}<br>
    أقصى عدد سيرفرات: ${limitText}`;
}

$('#btn-change-password').addEventListener('click', async () => {
  const currentPassword = $('#pwd-current').value;
  const newPassword = $('#pwd-new').value;
  if (!currentPassword || !newPassword) { toast('اكتب كلمة المرور الحالية والجديدة', 'error'); return; }
  try {
    await api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
    $('#pwd-current').value = '';
    $('#pwd-new').value = '';
    toast('تم تغيير كلمة المرور');
  } catch (err) {
    toast(err.message, 'error');
  }
});
