// ====== Bots / Dashboard ======
async function refreshServers() {
  await loadBots();
}

async function loadBots() {
  try {
    state.bots = await api('/api/bots');
    renderServers();
    updateStats();
    if (state.pendingServer && state.bots.some(b => b.id === state.pendingServer) && (!state.currentBot || state.currentBot.id !== state.pendingServer)) {
      const target = state.pendingServer;
      state.pendingServer = null;
      openServer(target);
    } else if (state.isServer && !state.currentBot && state.bots.length) {
      openServer(state.bots[0].id);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function updateStats() {
  const total = state.bots.length;
  const running = state.bots.filter(b => b.status === 'running' || b.status === 'starting').length;
  $('#stat-servers').textContent = total;
  $('#stat-running').textContent = running;
}

function statusMeta(status) {
  switch (status) {
    case 'running': return { cls: 'status-running', label: 'ONLINE' };
    case 'starting': return { cls: 'status-starting', label: 'STARTING' };
    case 'restarting': return { cls: 'status-starting', label: 'RESTARTING' };
    case 'stopping': return { cls: 'status-stopping', label: 'STOPPING' };
    case 'error': return { cls: 'status-error', label: 'ERROR' };
    default: return { cls: 'status-stopped', label: 'OFFLINE' };
  }
}

function fmtMB(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  return `${Math.round(bytes / 1048576)} MB`;
}

function fmtRate(bytesPerSec) {
  if (typeof bytesPerSec !== 'number' || !Number.isFinite(bytesPerSec)) return '—';
  if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

function renderServers() {
  const grid = $('#servers-grid');
  const q = state.search.trim().toLowerCase();
  const list = q ? state.bots.filter(b => b.name.toLowerCase().includes(q)) : state.bots;

  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">🖥️</div>
        <div class="es-title">${q ? 'مفيش نتائج' : 'مفيش سيرفرات لسه'}</div>
        <div class="es-sub">${q ? 'جرّب كلمة بحث تانية' : 'اضغط "سيرفر جديد" لإنشاء أول سيرفر ليك في LYNO UP'}</div>
      </div>`;
    return;
  }

  grid.innerHTML = list.map(bot => {
    const meta = statusMeta(bot.status);
    const canStart = bot.status === 'stopped' || bot.status === 'error';
    const isRunning = bot.status === 'running';
    const stats = state.botStats[bot.id] || {};
    const cpu = isRunning && typeof stats.cpu === 'number' ? stats.cpu : 0;
    const ram = isRunning && typeof stats.memory === 'number' ? stats.memory : 0;
    const ramPct = isRunning && stats.memoryLimit ? Math.min(100, (ram / stats.memoryLimit) * 100) : 0;
    const cpuText = isRunning ? (typeof stats.cpu === 'number' ? `${cpu.toFixed(1)}%` : '—') : '0%';
    const ramText = isRunning ? (typeof stats.memory === 'number' ? fmtMB(ram) : '—') : '0 MB';
    return `
      <div class="server-card" data-id="${bot.id}">
        <div class="server-card-top">
          <div class="server-card-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div style="flex:1;min-width:0">
            <div class="server-card-name">${esc(bot.name)}</div>
            <div class="server-card-sub"><span style="color:#c4b5fd;font-weight:700">NODE-1</span> · ${esc(bot.mainFile || 'index.js')}</div>
          </div>
          <span class="status-pill ${meta.cls}"><span class="dot"></span>${meta.label}</span>
        </div>
        <div class="server-card-metrics">
          <div class="metric-col">
            <div class="metric-top"><span>CPU</span><span data-stat="cpu">${cpuText}</span></div>
            <div class="metric-bar"><div class="metric-fill" data-fill="cpu" style="width: ${Math.min(100, cpu)}%"></div></div>
          </div>
          <div class="metric-col">
            <div class="metric-top"><span>RAM</span><span data-stat="ram">${ramText}</span></div>
            <div class="metric-bar"><div class="metric-fill" data-fill="ram" style="width: ${ramPct}%"></div></div>
          </div>
        </div>
        <div class="server-card-meta">
          <span class="owner">${state.isAdmin ? '👤 ' + esc(bot.ownerName || '—') : '🕒 ' + new Date(bot.createdAt).toLocaleDateString('en-GB')}</span>
          <div class="server-card-actions">
            ${canStart
              ? `<button class="mini-btn play" data-act="start" title="تشغيل / Start">▶</button>`
              : `<button class="mini-btn stop" data-act="stop" title="إيقاف / Stop">■</button>`}
          </div>
        </div>
      </div>`;
  }).join('');

  $$('.server-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) {
        e.stopPropagation();
        quickAction(card.dataset.id, btn.dataset.act);
        return;
      }
      openServer(card.dataset.id);
    });
  });
}

async function quickAction(id, act) {
  try {
    await api(`/api/bots/${id}/${act}`, { method: 'POST' });
    toast(act === 'start' ? 'جاري تشغيل السيرفر' : 'جاري إيقاف السيرفر');
    const poll = (n) => setTimeout(async () => { await loadBots(); if (n < 10 && state.bots.some(b => b.status === 'stopping' || b.status === 'starting')) poll(n + 1); }, 800);
    poll(0);
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#server-search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderServers();
});

// ====== Server View ======
async function openServer(id) {
  try {
    const bot = await api(`/api/bots/${id}`);
    state.currentBot = bot;
    state.currentDir = '';
    state.editingFile = null;

    $('#server-name').textContent = bot.name;
    $('#server-owner').textContent = state.isAdmin ? `المالك: ${bot.ownerName || '—'}` : '';
    $('#cred-username').textContent = '—';
    $('#cred-link').textContent = serverLink(id);
    $('#cred-pass-row').style.display = 'none';
    renderServerStatus(bot.status);

    $$('.page').forEach(p => p.classList.remove('active'));
    $('#page-server').classList.add('active');
    $('#breadcrumb').textContent = bot.name;
    $('#topbar-search').style.display = 'none';
    $('#btn-new-server').style.display = 'none';
    closeSidebar();

    selectTab('console');
    connectWs();
    loadLogs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function applyBotStats(s) {
  if (!s) return;
  if (state.currentBot && state.currentBot.id === s.botId) {
    const cpuEl = $('#telemetry-cpu');
    const ramEl = $('#telemetry-ram');
    const netEl = $('#telemetry-net');
    if (cpuEl) cpuEl.textContent = typeof s.cpu === 'number' ? `${s.cpu.toFixed(1)}%` : '—';
    if (ramEl) {
      ramEl.textContent = typeof s.memory === 'number'
        ? `${fmtMB(s.memory)} / ${fmtMB(s.memoryLimit)}`
        : `— / ${fmtMB(s.memoryLimit)}`;
    }
    if (netEl) netEl.textContent = `${fmtRate(s.netIn)} ↑ · ${fmtRate(s.netOut)} ↓`;
  }

  const card = document.querySelector(`.server-card[data-id="${s.botId}"]`);
  if (!card) return;
  const cpuVal = card.querySelector('[data-stat="cpu"]');
  const cpuFill = card.querySelector('[data-fill="cpu"]');
  const ramVal = card.querySelector('[data-stat="ram"]');
  const ramFill = card.querySelector('[data-fill="ram"]');
  if (cpuVal) cpuVal.textContent = typeof s.cpu === 'number' ? `${s.cpu.toFixed(1)}%` : '—';
  if (cpuFill) cpuFill.style.width = `${Math.min(100, typeof s.cpu === 'number' ? s.cpu : 0)}%`;
  if (ramVal) ramVal.textContent = typeof s.memory === 'number' ? fmtMB(s.memory) : '—';
  if (ramFill) {
    ramFill.style.width = `${s.memoryLimit && typeof s.memory === 'number'
      ? Math.min(100, (s.memory / s.memoryLimit) * 100)
      : 0}%`;
  }
}

function renderServerStatus(status) {
  const meta = statusMeta(status);
  const pill = $('#server-status-pill');
  if (pill) {
    pill.className = `status-pill ${meta.cls}`;
    pill.innerHTML = `<span class="dot"></span>${meta.label}`;
  }
  const isRunning = status === 'running';
  const stats = state.currentBot ? state.botStats[state.currentBot.id] : null;
  if (isRunning && stats) {
    applyBotStats(stats);
  } else {
    const cpuEl = $('#telemetry-cpu');
    const ramEl = $('#telemetry-ram');
    const netEl = $('#telemetry-net');
    const limit = stats && stats.memoryLimit ? fmtMB(stats.memoryLimit) : '—';
    if (cpuEl) cpuEl.textContent = isRunning ? '—' : '0.0%';
    if (ramEl) ramEl.textContent = isRunning ? `— / ${limit}` : `0 MB / ${limit}`;
    if (netEl) netEl.textContent = isRunning ? '— ↑ · — ↓' : '0 KB/s ↑ · 0 KB/s ↓';
  }
  updatePowerButtons(status);
}

const consoleForm = $('#console-form');
if (consoleForm) {
  consoleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#console-input');
    const cmd = input.value;
    if (!cmd.trim()) return;
    appendLine(`container@lynoup:~$ ${cmd}`, 'out');
    input.value = '';
    if (!state.currentBot || state.currentBot.status !== 'running') {
      appendLine('خطأ: السيرفر متوقف حالياً. اضغط "تشغيل" لبدء السيرفر أولاً.', 'err');
      return;
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      appendLine('خطأ: الاتصال المباشر بالسيرفر غير متاح. جاري إعادة الاتصال...', 'err');
      connectWs();
      return;
    }
    state.ws.send(JSON.stringify({
      type: 'command',
      botId: state.currentBot.id,
      command: cmd,
    }));
  });
}

const clearConsoleBtn = $('#btn-clear-console');
if (clearConsoleBtn) {
  clearConsoleBtn.addEventListener('click', () => {
    const body = $('#console-body');
    if (body) body.innerHTML = '<div class="terminal-hint">تم مسح الكونسول. المخرجات الجديدة ستظهر هنا.</div>';
  });
}

function updatePowerButtons(status) {
  const running = status === 'running' || status === 'starting' || status === 'restarting';
  const stopping = status === 'stopping';
  $$('.power-btn').forEach(btn => {
    const act = btn.dataset.action;
    // Restart and Kill stay available while "stopping" so a stuck server can always be recovered.
    if (act === 'start') btn.disabled = running || stopping;
    if (act === 'restart') btn.disabled = false;
    if (act === 'stop') btn.disabled = !running;
    if (act === 'kill') btn.disabled = !(running || stopping);
  });
}

$$('.power-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.currentBot) return;
    const act = btn.dataset.action;
    try {
      const r = await api(`/api/bots/${state.currentBot.id}/${act}`, { method: 'POST' });
      if (r && r.success === false) { toast(r.error, 'error'); return; }
      const labels = { start: 'جاري التشغيل', restart: 'جاري إعادة التشغيل', stop: 'جاري الإيقاف', kill: 'إنهاء قسري' };
      toast(labels[act] || 'تم');
      pollStatus();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
});

// Poll until the status settles, so a missed WebSocket message can't leave the UI stuck.
let pollTimer = null;
function pollStatus(tries = 0) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!state.currentBot) return;
    await refreshServerStatus();
    loadBots();
    const st = state.currentBot && state.currentBot.status;
    if ((st === 'stopping' || st === 'starting' || tries < 2) && tries < 20) pollStatus(tries + 1);
  }, 700);
}

async function refreshServerStatus() {
  if (!state.currentBot) return;
  try {
    const bot = await api(`/api/bots/${state.currentBot.id}`);
    state.currentBot = bot;
    renderServerStatus(bot.status);
  } catch (_) { /* ignore */ }
}

// Tabs
function selectTab(tab) {
  $$('#page-server .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = $(`#tab-${tab}`);
  if (panel) panel.classList.add('active');
  if (tab === 'files') loadFiles(state.currentDir);
  if (tab === 'startup') { renderStartup(); loadCredentials(); }
}
$$('#page-server .tab').forEach(t => t.addEventListener('click', () => selectTab(t.dataset.tab)));

// ====== Console ======
function appendLine(line, type) {
  const body = $('#console-body');
  const hint = $('.terminal-hint', body);
  if (hint) hint.remove();
  const div = document.createElement('div');
  div.className = `line line-${type || 'out'}`;
  div.textContent = line.replace(/\n$/, '');
  body.appendChild(div);
  while (body.childElementCount > 1000) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
}

function classifyLine(line) {
  const l = line.toLowerCase();
  if (/(error|err|throw|exception|failed|traceback|at )/.test(l)) return 'err';
  return 'out';
}

async function loadLogs() {
  if (!state.currentBot) return;
  const body = $('#console-body');
  body.innerHTML = '';
  try {
    const data = await api(`/api/bots/${state.currentBot.id}/logs?limit=300`);
    if (!data.logs || !data.logs.length) {
      body.innerHTML = '<div class="terminal-hint">اضغط "تشغيل" لبدء السيرفر ومراقبة المخرجات هنا مباشرة...</div>';
      return;
    }
    for (const log of data.logs) appendLine(log.text, log.type);
  } catch (_) { /* ignore */ }
}

// ====== WebSocket ======
function connectWs() {
  if (state.ws) { try { state.ws.close(); } catch (_) {} }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/?token=${encodeURIComponent(getToken())}`);
  state.ws = ws;
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.type === 'stats') {
      state.botStats[msg.botId] = msg;
      applyBotStats(msg);
      return;
    }
    if (!state.currentBot || msg.botId !== state.currentBot.id) {
      if (msg.type === 'status') loadBots();
      return;
    }
    if (msg.type === 'log') {
      appendLine(msg.line, msg.stream || classifyLine(msg.line));
    } else if (msg.type === 'status') {
      state.currentBot.status = msg.status;
      renderServerStatus(msg.status);
      loadBots();
    } else if (msg.type === 'command-error') {
      appendLine(`خطأ: ${msg.error}`, 'err');
    }
  });
  ws.addEventListener('close', (ev) => {
    if (ev.code !== 4401 && state.user) {
      setTimeout(() => { if (state.user) connectWs(); }, 4000);
    }
  });
}
