// ====== Auth ======
const authScreen = $('#auth-screen');
const appEl = $('.app');

async function checkAuth() {
  try {
    const data = await api('/api/auth/me');
    if (data.authenticated) {
      enterApp(data.user);
    } else {
      showAuth();
    }
  } catch (_) {
    showAuth();
  } finally {
    $('#splash').classList.add('hidden');
    document.body.classList.remove('app-loading');
  }
}

function showAuth() {
  appEl.classList.remove('active');
  authScreen.classList.add('active');
  $('#auth-username').focus();
}

function enterApp(user) {
  state.user = user;
  state.isAdmin = user.role === 'admin';
  state.isServer = user.role === 'server';
  state.canCreate = !state.isServer;
  authScreen.classList.remove('active');
  appEl.classList.add('active');

  $('#user-name').textContent = user.username;
  $('#user-role').textContent = roleLabel(user.role);
  $('#user-avatar').textContent = user.username.charAt(0).toUpperCase();

  $$('.admin-only').forEach(el => { el.style.display = state.isAdmin ? '' : 'none'; });
  $$('.no-server').forEach(el => { el.style.display = state.isServer ? 'none' : ''; });

  api('/api/platform').then(p => { state.panelUrl = p.panelUrl || location.origin; }).catch(() => {
    state.panelUrl = location.origin;
  });

  loadBots();
  loadSystem();
  connectWs();
  switchPage('dashboard');
}

async function handleLogout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  setToken('');
  if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
  state.user = null;
  state.bots = [];
  state.currentBot = null;
  showAuth();
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#auth-submit');
  const errEl = $('#auth-error');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'جاري الدخول...';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { username: $('#auth-username').value, password: $('#auth-password').value },
    });
    $('#auth-password').value = '';
    setToken(data.token);
    enterApp(data.user);
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'تسجيل الدخول / Login';
  }
});

const authTogglePass = $('#auth-toggle-pass');
if (authTogglePass) {
  authTogglePass.addEventListener('click', () => {
    const p = $('#auth-password');
    if (p.type === 'password') {
      p.type = 'text';
      authTogglePass.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    } else {
      p.type = 'password';
      authTogglePass.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
  });
}

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const searchInput = $('#server-search');
    if (searchInput) searchInput.focus();
  }
});

$('#btn-logout').addEventListener('click', handleLogout);

// ====== Navigation ======
const pageTitles = {
  dashboard: 'لوحة التحكم',
  'dashboard-servers': 'السيرفرات',
  users: 'إدارة المستخدمين',
  system: 'معلومات النظام',
  account: 'حسابي',
};

function switchPage(page) {
  if (page === 'dashboard-servers') page = 'dashboard';
  if (page === 'users' && !state.isAdmin) page = 'dashboard';
  if (page === 'system' && !state.isAdmin) page = 'dashboard';

  $$('.page').forEach(p => p.classList.remove('active'));
  const target = $(`#page-${page}`);
  if (target) target.classList.add('active');

  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page || (page === 'dashboard' && n.dataset.page === 'dashboard')));

  $('#breadcrumb').textContent = pageTitles[page] || 'لوحة التحكم';
  $('#topbar-search').style.display = page === 'dashboard' ? '' : 'none';
  $('#btn-new-server').style.display = (page === 'dashboard' && state.canCreate) ? '' : 'none';

  const serverPage = $('#page-server');
  if (page !== 'server') {
    serverPage.classList.remove('active');
  }

  closeSidebar();

  if (page === 'users') loadUsers();
  if (page === 'system') loadSystem();
  if (page === 'account') renderAccount();
}

$$('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(item.dataset.page);
  });
});

// Sidebar mobile
function closeSidebar() {
  $('.sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('active');
}
$('#menu-toggle').addEventListener('click', () => {
  $('.sidebar').classList.add('open');
  $('#sidebar-overlay').classList.add('active');
});
$('#sidebar-overlay').addEventListener('click', closeSidebar);
