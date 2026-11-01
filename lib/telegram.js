'use strict';
/*
 * Telegram control bot for the LYNO UP panel — fully button-driven.
 *
 * Zero external dependencies (global fetch / FormData / Blob, Node 18+).
 * Every panel operation runs through the panel's own REST API over localhost
 * with a Bearer token, reusing all existing auth, access-control and file
 * logic. Login itself is delegated to `deps.authenticate` (in-memory store)
 * to bypass the HTTP login rate limit, since all bot calls share the loopback IP.
 *
 * UX: buttons for everything. The login flow asks for the username first, the
 * user sends it, then the bot asks for the password.
 */

const path = require('path');
const fs = require('fs-extra');

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const POLL_TIMEOUT = 30;
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|tbz2?|xz|txz|lzma|cab|iso|arj|cpio|jar|war|apk|whl)$/i;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function encPath(rel) {
  return String(rel || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function parentOf(rel) {
  const idx = String(rel || '').lastIndexOf('/');
  return idx === -1 ? '' : String(rel).slice(0, idx);
}

function isArchiveName(name) {
  return ARCHIVE_RE.test(String(name || ''));
}

function statusIcon(status) {
  if (status === 'running') return '🟢';
  if (status === 'stopping') return '🟠';
  if (status === 'error') return '⚠️';
  return '🔴';
}

function btn(text, data) {
  return { text: String(text).slice(0, 64), callback_data: String(data).slice(0, 64) };
}

function kb(rows) {
  return { inline_keyboard: rows };
}

/**
 * @param {object} deps
 * @param {string} deps.token              Bot token from @BotFather
 * @param {string} [deps.apiBase]          Telegram API base (default https://api.telegram.org)
 * @param {string} deps.panelBase          Panel base URL, e.g. http://127.0.0.1:24691
 * @param {string} deps.tmpDir             Temp dir for uploads
 * @param {number} deps.maxUploadMb        Max upload size (MB)
 * @param {Set<number>|null} deps.allowedIds  Optional allow-list of Telegram user ids
 * @param {(u:string,p:string)=>Promise<{token:string,user:object}|null>} deps.authenticate
 */
function createTelegramBot(deps) {
  const token = deps.token;
  const API_BASE = String(deps.apiBase || 'https://api.telegram.org').replace(/\/+$/, '');
  const FILE_BASE = `${API_BASE}/file`;
  const panelBase = String(deps.panelBase || '').replace(/\/+$/, '');
  const tmpDir = deps.tmpDir;
  const authenticate = deps.authenticate;
  const allowedIds = deps.allowedIds || null;
  const maxUploadMb = deps.maxUploadMb || 50;

  const sessions = new Map();
  let offset = 0;
  let running = false;
  let botInfo = { username: '' };

  // ====== Telegram API ======
  async function tg(method, params, timeoutMs = 60000) {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || `Telegram API error: ${method}`);
    return data.result;
  }

  async function tgForm(method, form, timeoutMs = 120000) {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || `Telegram API error: ${method}`);
    return data.result;
  }

  function isAllowed(id) {
    if (!allowedIds) return true;
    return allowedIds.has(Number(id));
  }

  async function send(chatId, text, keyboard) {
    const body = {
      chat_id: chatId,
      text: String(text).length > 4000 ? String(text).slice(0, 4000) : String(text),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (keyboard) body.reply_markup = keyboard;
    try { return await tg('sendMessage', body); } catch (err) { console.error('tg sendMessage:', err.message); }
  }

  async function edit(chatId, messageId, text, keyboard) {
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text: String(text).length > 4000 ? String(text).slice(0, 4000) : String(text),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (keyboard) body.reply_markup = keyboard;
    try { await tg('editMessageText', body); } catch (_) { /* not modified / too old */ }
  }

  async function typing(chatId) {
    try { await tg('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch (_) { /* ignore */ }
  }

  async function sendDocument(chatId, buffer, filename, caption) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([buffer]), filename);
    if (caption) form.append('caption', String(caption).slice(0, 1024));
    return tgForm('sendDocument', form);
  }

  async function answerCq(id, text) {
    try { await tg('answerCallbackQuery', text ? { callback_query_id: id, text } : { callback_query_id: id }); } catch (_) { /* ignore */ }
  }

  // ====== Panel API (localhost, Bearer) ======
  async function panelFetch(session, method, apiPath, body, isForm, timeoutMs = 120000) {
    const headers = {};
    if (session && session.token) headers.Authorization = `Bearer ${session.token}`;
    let payload;
    if (isForm) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(panelBase + apiPath, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: res.ok, status: res.status, buffer, contentType: ct };
  }

  // ====== Sessions ======
  function getSession(chatId) {
    const s = sessions.get(chatId);
    if (!s) return null;
    if (s.expiresAt < Date.now()) { sessions.delete(chatId); return null; }
    return s;
  }

  function ensureSession(chatId) {
    let s = sessions.get(chatId);
    if (!s) { s = { awaiting: null, pendingUsername: '', curDir: '', lastListing: [], activeBotId: null }; sessions.set(chatId, s); }
    s.expiresAt = Date.now() + SESSION_TTL_MS;
    return s;
  }

  function clearLogin(session) {
    session.token = null; session.userId = null; session.username = null; session.role = null;
    session.activeBotId = null; session.curDir = ''; session.lastListing = []; session.awaiting = null;
  }

  // ====== Servers ======
  async function fetchServers(session) {
    const r = await panelFetch(session, 'GET', '/api/bots');
    if (!r.ok || !Array.isArray(r.data)) return [];
    return r.data;
  }

  async function statusMessage(session) {
    if (!session.activeBotId) return null;
    const r = await panelFetch(session, 'GET', `/api/bots/${session.activeBotId}`);
    if (!r.ok) return null;
    const b = r.data;
    return `🖥️ <b>${esc(b.name)}</b>\n` +
      `الحالة: ${statusIcon(b.status)} <b>${esc(b.status)}</b>\n` +
      `الملف الرئيسي: <code>${esc(b.mainFile || 'index.js')}</code>\n` +
      `المالك: ${esc(b.ownerName || '—')}`;
  }

  // ====== Keyboards ======
  function cancelRow() { return [btn('✖️ إلغاء', 'cancel')]; }

  function welcomeKeyboard(session) {
    const rows = [];
    if (!session || !session.token) rows.push([btn('🔐 تسجيل الدخول', 'login')]);
    else rows.push([btn('🏠 القائمة الرئيسية', 'menu')]);
    rows.push([btn('ℹ️ طريقة الاستخدام', 'help')]);
    return kb(rows);
  }

  function mainKeyboard(session) {
    const rows = [];
    if (!session || !session.token) return welcomeKeyboard(session);
    if (session.activeBotId) {
      rows.push([btn('🖥️ الحالة', 'm:status'), btn('📂 الملفات', 'm:files')]);
      rows.push([btn('📜 السجلات', 'm:logs'), btn('🗄️ السيرفرات', 'm:servers')]);
      rows.push([btn('▶️ تشغيل', 'power:start'), btn('⏹️ إيقاف', 'power:stop')]);
      rows.push([btn('🔄 إعادة تشغيل', 'power:restart'), btn('❌ إنهاء قسري', 'power:kill')]);
    } else {
      rows.push([btn('🗄️ السيرفرات', 'm:servers'), btn('🔐 تبديل الحساب', 'login')]);
    }
    rows.push([btn('ℹ️ طريقة الاستخدام', 'help'), btn('🚪 خروج', 'logout')]);
    return kb(rows);
  }

  function statusKeyboard() {
    return kb([
      [btn('🔄 تحديث', 'm:status'), btn('📜 السجلات', 'm:logs')],
      [btn('▶️ تشغيل', 'power:start'), btn('⏹️ إيقاف', 'power:stop')],
      [btn('🔄 إعادة تشغيل', 'power:restart'), btn('❌ إنهاء', 'power:kill')],
      [btn('📂 الملفات', 'm:files'), btn('🏠 القائمة', 'menu')],
    ]);
  }

  function serversKeyboard(session, servers) {
    const rows = servers.map((s, i) => [btn(`${statusIcon(s.status)} ${s.name}${session.activeBotId === s.id ? ' ✅' : ''}`, `srv:${i}`)]);
    rows.push([btn('🔄 تحديث', 'm:servers')]);
    rows.push([btn('🏠 القائمة', 'menu')]);
    return kb(rows);
  }

  // ====== Menus ======
  async function showWelcome(chatId, session) {
    await send(chatId,
      '🤖 <b>مرحباً بك في لوحة تحكم البوتات</b>\n\nاضغط زر "تسجيل الدخول" وأنا هطلب منك اسم المستخدم وبعده كلمة المرور.',
      welcomeKeyboard(session));
  }

  async function showMain(chatId, session, msgId) {
    let text = `🏠 <b>القائمة الرئيسية</b>\n`;
    if (session.token) {
      text += `👤 ${esc(session.username)} (${esc(session.role)})\n`;
      const st = await statusMessage(session);
      text += st ? `\n${st}` : '\n⚠️ اختار سيرفر من "السيرفرات" الأول.';
    }
    if (msgId) await edit(chatId, msgId, text, mainKeyboard(session));
    else await send(chatId, text, mainKeyboard(session));
  }

  async function showHelp(chatId, session, msgId) {
    const text = '🤖 <b>طريقة الاستخدام</b>\n\n' +
      '• <b>تسجيل الدخول</b>: اضغط "تسجيل الدخول" → هبعت اسم المستخدم → هطلب كلمة المرور.\n' +
      '• <b>السيرفرات</b>: اختر سيرفر من زر "السيرفرات".\n' +
      '• <b>الحالة</b>: تشغيل/إيقاف/إعادة/إنهاء بأزرار مباشرة.\n' +
      '• <b>الملفات</b>: تصفّح بالضغط على المجلدات، وافتح ملف لخياراته (تنزيل/ضغط/فك ضغط/حذف).\n' +
      '• <b>رفع ملف</b>: من داخل المجلد اضغط "⬆️ رفع ملف هنا" وبعدين ابعت الملف.\n' +
      '• <b>تنصيب المكتبات</b>: زر "📚 تنصيب المكتبات" يشغّل npm install.\n\n' +
      'أوامر نصية اختيارية: <code>/start</code> <code>/cancel</code> <code>/logout</code>';
    const k = kb([[session && session.token ? btn('🏠 القائمة الرئيسية', 'menu') : btn('🔐 تسجيل الدخول', 'login')]]);
    if (msgId) await edit(chatId, msgId, text, k);
    else await send(chatId, text, k);
  }

  async function showStatus(chatId, session, msgId) {
    const st = await statusMessage(session);
    const text = st || '❌ فشل جلب الحالة';
    if (msgId) await edit(chatId, msgId, text, statusKeyboard());
    else await send(chatId, text, statusKeyboard());
  }

  async function showServers(chatId, session, msgId) {
    const servers = await fetchServers(session);
    if (!servers.length) {
      const text = 'مفيش سيرفرات متاحة لحسابك.';
      if (msgId) await edit(chatId, msgId, text, kb([[btn('🏠 القائمة', 'menu')]]));
      else await send(chatId, text, kb([[btn('🏠 القائمة', 'menu')]]));
      return;
    }
    session.serverList = servers.map(s => ({ id: s.id, name: s.name, status: s.status }));
    if (servers.length === 1 && !session.activeBotId) session.activeBotId = servers[0].id;
    const text = '🗄️ <b>اختار سيرفر:</b>\n' + servers.map((s, i) => `${i + 1}. ${statusIcon(s.status)} <b>${esc(s.name)}</b>${session.activeBotId === s.id ? ' ✅' : ''}`).join('\n');
    if (msgId) await edit(chatId, msgId, text, serversKeyboard(session, servers));
    else await send(chatId, text, serversKeyboard(session, servers));
  }

  // ====== Files ======
  async function showListing(chatId, session, rel, msgId) {
    if (!session.activeBotId) { await showMain(chatId, session, msgId); return; }
    session.curDir = rel || '';
    const apiPath = session.curDir
      ? `/api/bots/${session.activeBotId}/files/${encPath(session.curDir)}`
      : `/api/bots/${session.activeBotId}/files`;
    const r = await panelFetch(session, 'GET', apiPath);
    if (!r.ok) {
      const text = '❌ ' + esc((r.data && r.data.error) || 'فشل جلب الملفات');
      if (msgId) await edit(chatId, msgId, text, kb([[btn('🔄 تحديث', 'm:files'), btn('🏠 القائمة', 'menu')]]));
      else await send(chatId, text);
      return;
    }
    const items = Array.isArray(r.data) ? r.data : [];
    items.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : (a.isDirectory ? -1 : 1)));
    session.lastListing = items.map(it => ({
      name: it.name,
      isDirectory: Boolean(it.isDirectory),
      size: it.size,
      path: (session.curDir ? session.curDir + '/' : '') + it.name,
    }));

    const dirs = session.lastListing.filter(it => it.isDirectory).length;
    const files = session.lastListing.length - dirs;
    const text = `📂 <b>${esc(session.curDir || '/')}</b>\n(${dirs} مجلد • ${files} ملف)`;

    const rows = [];
    if (session.curDir) rows.push([btn('⬆️ رجوع', 'up')]);
    session.lastListing.forEach((it, i) => {
      const icon = it.isDirectory ? '📁' : (isArchiveName(it.name) ? '🗜️' : '📄');
      rows.push([btn(`${icon} ${it.name}`, `nav:${i}`)]);
    });
    rows.push([btn('⬆️ رفع ملف هنا', 'upl'), btn('🔄 تحديث', 'ref')]);
    rows.push([btn('📚 تنصيب المكتبات', 'inst'), btn('🏠 القائمة', 'menu')]);

    if (msgId) await edit(chatId, msgId, text, kb(rows));
    else await send(chatId, text, kb(rows));
  }

  async function showFileActions(chatId, session, i, msgId) {
    const it = session.lastListing[i];
    if (!it) { await send(chatId, '⚠️ العنصر غير موجود، اعمل تحديث.'); return; }
    const text = `${it.isDirectory ? '📁' : '📄'} <b>${esc(it.name)}</b>\nالمسار: <code>${esc(it.path)}</code>` +
      (it.isDirectory ? '' : `\nالحجم: ${fmtSize(it.size)}`);

    const rows = [];
    if (it.isDirectory) rows.push([btn('📂 فتح المجلد', `nav:${i}`)]);
    else rows.push([btn('⬇️ تنزيل', `dl:${i}`)]);
    rows.push([btn('📦 ضغط ZIP', `zip:${i}`)]);
    if (!it.isDirectory && isArchiveName(it.name)) rows.push([btn('🗜️ فك الضغط', `ex:${i}`)]);
    rows.push([btn('🗑️ حذف', `del:${i}`)]);
    rows.push([btn('⬆️ رجوع للقائمة', 'm:files')]);

    if (msgId) await edit(chatId, msgId, text, kb(rows));
    else await send(chatId, text, kb(rows));
  }

  // ====== Actions ======
  async function doPower(chatId, session, action, msgId) {
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) return;
    await typing(chatId);
    const r = await panelFetch(session, 'POST', `/api/bots/${session.activeBotId}/${action}`, {});
    const labels = { start: 'تشغيل', stop: 'إيقاف', restart: 'إعادة تشغيل', kill: 'إنهاء قسري' };
    if (r.ok && (r.data.success === undefined || r.data.success)) {
      await send(chatId, `✅ تم ${labels[action]}.`);
    } else {
      await send(chatId, '❌ ' + esc((r.data && (r.data.error || r.data.message)) || 'فشل التنفيذ'));
    }
    await showStatus(chatId, session, msgId || null);
  }

  async function downloadAndSend(chatId, session, it) {
    await typing(chatId);
    const r = await panelFetch(session, 'GET', `/api/bots/${session.activeBotId}/download/${encPath(it.path)}`, undefined, false, 300000);
    if (!r.ok || !r.buffer) {
      await send(chatId, '❌ فشل التنزيل: ' + esc((r.data && r.data.error) || 'خطأ غير معروف'));
      return;
    }
    if (r.buffer.length > 50 * 1024 * 1024) {
      await send(chatId, '⚠️ الملف أكبر من 50MB، تليجرام مش هيقدر يستقبله.');
      return;
    }
    const name = it.isDirectory ? `${it.name}.zip` : it.name;
    try { await sendDocument(chatId, r.buffer, name, it.isDirectory ? '📦 مجلد مضغوط' : undefined); }
    catch (err) { await send(chatId, '❌ فشل الإرسال: ' + esc(err.message)); }
  }

  async function doExtract(chatId, session, filePath, password) {
    await typing(chatId);
    const body = { file: filePath };
    if (password) body.password = password;
    const r = await panelFetch(session, 'POST', `/api/bots/${session.activeBotId}/extract`, body, false, 300000);
    if (r.ok) { await send(chatId, `✅ تم فك الضغط (${r.data.extracted} عنصر).`); return; }
    if (r.status === 422 && r.data && r.data.code) {
      session.awaiting = { type: 'extract', filePath };
      await send(chatId, '🔒 الأرشيف محمي بكلمة مرور.\nابعت كلمة المرور في رسالة، أو اضغط إلغاء.', kb(cancelRow()));
      return;
    }
    await send(chatId, '❌ ' + esc((r.data && r.data.error) || 'فشل فك الضغط'));
  }

  async function doZip(chatId, session, relPaths, destName) {
    if (!relPaths.length) { await send(chatId, 'حدد ملفات/مجلدات.'); return; }
    const name = (destName || 'archive').replace(/\.(zip|tar\.gz|tgz)$/i, '') + '.zip';
    await typing(chatId);
    const r = await panelFetch(session, 'POST', `/api/bots/${session.activeBotId}/archive`, { paths: relPaths, format: 'zip', dest: name }, false, 300000);
    if (r.ok) await send(chatId, `✅ تم إنشاء الأرشيف <code>${esc(r.data.file)}</code> (${r.data.count} عنصر).`);
    else await send(chatId, '❌ ' + esc((r.data && r.data.error) || 'فشل الضغط'));
  }

  async function doInstall(chatId, session) {
    await send(chatId, '⏳ جاري تنصيب المكتبات...');
    await typing(chatId);
    const r = await panelFetch(session, 'POST', `/api/bots/${session.activeBotId}/install`, {}, false, 260000);
    if (r.ok) await send(chatId, '✅ تم التنصيب بنجاح.');
    else await send(chatId, '❌ ' + esc((r.data && r.data.error) || 'فشل التنصيب'));
  }

  async function showLogs(chatId, session) {
    const r = await panelFetch(session, 'GET', `/api/bots/${session.activeBotId}/logs?limit=80`);
    if (!r.ok) { await send(chatId, '❌ فشل جلب السجلات'); return; }
    const lines = (r.data.logs || []).map(l => l.text).join('');
    if (!lines.trim()) { await send(chatId, '📜 لا توجد سجلات بعد.', kb([[btn('🔄 تحديث', 'm:logs'), btn('🏠 القائمة', 'menu')]])); return; }
    const tail = lines.length > 3500 ? lines.slice(-3500) : lines;
    await send(chatId, '📜 <b>آخر السجلات:</b>\n<pre>' + esc(tail) + '</pre>',
      kb([[btn('🔄 تحديث', 'm:logs'), btn('🖥️ الحالة', 'm:status')], [btn('🏠 القائمة', 'menu')]]));
  }

  // ====== Login flow ======
  async function askUsername(chatId) {
    const session = ensureSession(chatId);
    session.awaiting = 'username';
    session.pendingUsername = '';
    await send(chatId, '👤 <b>ابعتلي اسم المستخدم:</b>', kb(cancelRow()));
  }

  async function doLogin(chatId, username, password) {
    const session = ensureSession(chatId);
    const result = await authenticate(username, password);
    session.awaiting = null;
    session.pendingUsername = '';
    if (!result) {
      await send(chatId, '❌ اسم المستخدم أو كلمة المرور غلط، أو الحساب موقوف.\nحاول تاني.', kb([[btn('🔁 محاولة تسجيل دخول', 'login')], [btn('🏠 القائمة', 'menu')]]));
      return;
    }
    const u = result.user;
    session.token = result.token;
    session.userId = u.id;
    session.username = u.username;
    session.role = u.role;
    session.activeBotId = u.role === 'server' ? u.botId : null;
    session.curDir = '';
    session.lastListing = [];
    const roleLabel = u.role === 'admin' ? 'مشرف' : (u.role === 'server' ? 'حساب سيرفر' : 'مستخدم');
    await send(chatId, `✅ تم تسجيل الدخول\n👤 <b>${esc(u.username)}</b> (${roleLabel})`);
    await showServers(chatId, session, null);
  }

  // ====== Incoming files (upload) ======
  async function handleIncomingFile(chatId, session, msg) {
    const doc = msg.document || msg.video || msg.audio || (msg.photo && msg.photo[msg.photo.length - 1]);
    if (!doc || !doc.file_id) {
      await send(chatId, 'ابعت ملف حقيقي لو سمحت.', kb(cancelRow()));
      return;
    }
    const dir = (session.awaiting && session.awaiting.dir) || session.curDir || '';
    const size = doc.file_size || 0;
    if (size > maxUploadMb * 1024 * 1024) {
      session.awaiting = null;
      await send(chatId, `❌ الملف أكبر من الحد المسموح (${maxUploadMb}MB).`);
      return;
    }
    const name = msg.document && msg.document.file_name ? msg.document.file_name : 'file.dat';
    try {
      const info = await tg('getFile', { file_id: doc.file_id });
      const res = await fetch(`${FILE_BASE}/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error('download failed');
      const buf = Buffer.from(await res.arrayBuffer());
      session.awaiting = null;
      const form = new FormData();
      form.append('file', new Blob([buf]), name);
      if (dir) form.append('path', dir);
      const r = await panelFetch(session, 'POST', `/api/bots/${session.activeBotId}/upload`, form, true, 180000);
      if (r.ok) await send(chatId, `✅ تم رفع <code>${esc(name)}</code> إلى <code>${esc(dir || '/')}</code>`);
      else await send(chatId, '❌ فشل الرفع: ' + esc((r.data && r.data.error) || 'خطأ'));
    } catch (err) {
      session.awaiting = null;
      await send(chatId, '❌ فشل تحميل الملف من تليجرام: ' + esc(err.message));
    }
  }

  // ====== Callback dispatcher ======
  async function handleCallback(cq) {
    const chatId = cq.message && cq.message.chat && cq.message.chat.id;
    const msgId = cq.message && cq.message.message_id;
    if (!chatId) { await answerCq(cq.id); return; }
    if (!isAllowed(cq.from && cq.from.id)) { await answerCq(cq.id); return; }

    const session = ensureSession(chatId);
    const data = String(cq.data || '');
    const sep = data.indexOf(':');
    const op = sep === -1 ? data : data.slice(0, sep);
    const arg = sep === -1 ? '' : data.slice(sep + 1);
    const i = arg === '' ? -1 : parseInt(arg, 10);

    try {
      if (op === 'cancel') {
        session.awaiting = null; session.pendingUsername = '';
        await answerCq(cq.id, 'تم الإلغاء');
        await send(chatId, 'تم الإلغاء.', welcomeKeyboard(session));
        return;
      }
      if (op === 'login') { await answerCq(cq.id); session.awaiting = null; await askUsername(chatId); return; }
      if (op === 'menu') { await answerCq(cq.id); await showMain(chatId, session, msgId); return; }
      if (op === 'help') { await answerCq(cq.id); await showHelp(chatId, session, msgId); return; }
      if (op === 'logout') { await answerCq(cq.id); clearLogin(session); sessions.delete(chatId); await send(chatId, '👋 تم تسجيل الخروج.', welcomeKeyboard(null)); return; }

      if (!session.token) { await answerCq(cq.id, 'سجّل الدخول أول'); await askUsername(chatId); return; }

      if (op === 'm') {
        await answerCq(cq.id);
        if (arg === 'status') { if (session.activeBotId) await showStatus(chatId, session, msgId); else await send(chatId, 'اختار سيرفر الأول.', kb([[btn('🗄️ السيرفرات', 'm:servers')], [btn('🏠 القائمة', 'menu')]])); }
        else if (arg === 'files') { if (session.activeBotId) await showListing(chatId, session, session.curDir || '', msgId); else await send(chatId, 'اختار سيرفر الأول.', kb([[btn('🗄️ السيرفرات', 'm:servers')], [btn('🏠 القائمة', 'menu')]])); }
        else if (arg === 'logs') { if (session.activeBotId) await showLogs(chatId, session); else await send(chatId, 'اختار سيرفر الأول.', kb([[btn('🗄️ السيرفرات', 'm:servers')], [btn('🏠 القائمة', 'menu')]])); }
        else if (arg === 'servers') await showServers(chatId, session, msgId);
        return;
      }

      if (op === 'power') {
        await answerCq(cq.id);
        if (!session.activeBotId) { await send(chatId, 'اختار سيرفر الأول.'); return; }
        await doPower(chatId, session, arg, msgId);
        return;
      }

      if (op === 'srv') {
        const s = (session.serverList || [])[i];
        if (!s) { await answerCq(cq.id, 'غير موجود'); await showServers(chatId, session, msgId); return; }
        await answerCq(cq.id, 'تم اختيار ' + s.name);
        session.activeBotId = s.id;
        session.curDir = '';
        await showStatus(chatId, session, msgId);
        return;
      }

      if (op === 'up') { await answerCq(cq.id); await showListing(chatId, session, parentOf(session.curDir), msgId); return; }
      if (op === 'ref') { await answerCq(cq.id); await showListing(chatId, session, session.curDir || '', msgId); return; }

      if (op === 'nav') {
        const it = session.lastListing[i];
        if (!it) { await answerCq(cq.id, 'حدثت الصفحة'); await showListing(chatId, session, session.curDir || '', msgId); return; }
        await answerCq(cq.id);
        if (it.isDirectory) await showListing(chatId, session, it.path, msgId);
        else await showFileActions(chatId, session, i, msgId);
        return;
      }

      if (op === 'dl') { const it = session.lastListing[i]; await answerCq(cq.id); if (it) await downloadAndSend(chatId, session, it); return; }
      if (op === 'ex') { const it = session.lastListing[i]; await answerCq(cq.id); if (it) await doExtract(chatId, session, it.path, ''); return; }
      if (op === 'zip') { const it = session.lastListing[i]; await answerCq(cq.id); if (it) await doZip(chatId, session, [it.path], it.name); return; }
      if (op === 'inst') { await answerCq(cq.id); if (session.activeBotId) await doInstall(chatId, session); return; }
      if (op === 'upl') {
        await answerCq(cq.id);
        session.awaiting = { type: 'upload', dir: session.curDir || '' };
        await send(chatId, `📤 <b>ابعت الملف دلوقتي</b>\nسيتم رفعه إلى: <code>${esc(session.curDir || '/')}</code>`, kb(cancelRow()));
        return;
      }

      if (op === 'del') {
        const it = session.lastListing[i];
        await answerCq(cq.id);
        if (!it) return;
        await edit(chatId, msgId, `⚠️ متأكد من حذف <b>${esc(it.name)}</b>؟`, kb([[btn('✅ نعم، احذف', `del2:${i}`), btn('❌ لا', 'm:files')]]));
        return;
      }
      if (op === 'del2') {
        const it = session.lastListing[i];
        await answerCq(cq.id);
        if (!it) return;
        const r = await panelFetch(session, 'DELETE', `/api/bots/${session.activeBotId}/files/${encPath(it.path)}`);
        await send(chatId, r.ok ? '✅ تم الحذف.' : '❌ ' + esc((r.data && r.data.error) || 'فشل'));
        await showListing(chatId, session, session.curDir || '', msgId);
        return;
      }

      await answerCq(cq.id);
    } catch (err) {
      await answerCq(cq.id, 'خطأ').catch(() => {});
      await send(chatId, '❌ ' + esc(err.message));
    }
  }

  // ====== Text handler (login inputs, upload/extract) ======
  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    if (!isAllowed(msg.from && msg.from.id)) return;
    const session = ensureSession(chatId);
    const text = (msg.text || '').trim();

    if (msg.document || msg.video || msg.audio || msg.voice || msg.photo) {
      if (!session.token) { await send(chatId, '🔒 سجّل الدخول الأول.', welcomeKeyboard(session)); return; }
      if (session.awaiting && session.awaiting.type === 'upload') await handleIncomingFile(chatId, session, msg);
      else await send(chatId, 'لرفع ملف اضغط "⬆️ رفع ملف هنا" من قائمة الملفات.');
      return;
    }

    if (!text) return;

    // login username step
    if (session.awaiting === 'username') {
      session.pendingUsername = text.replace(/^\s+|\s+$/g, '');
      session.awaiting = 'password';
      await send(chatId, '🔑 <b>ابعتلي كلمة المرور:</b>', kb(cancelRow()));
      return;
    }
    // login password step
    if (session.awaiting === 'password') {
      const username = session.pendingUsername;
      session.pendingUsername = '';
      await doLogin(chatId, username, text);
      return;
    }
    // extract password step
    if (session.awaiting && session.awaiting.type === 'extract') {
      const filePath = session.awaiting.filePath;
      session.awaiting = null;
      await doExtract(chatId, session, filePath, text);
      return;
    }

    if (text.startsWith('/')) {
      const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@[\w_]+$/, '');
      if (cmd === '/cancel') { session.awaiting = null; await send(chatId, 'تم الإلقاء.', welcomeKeyboard(session)); return; }
      if (cmd === '/start' || cmd === '/help' || cmd === '/menu') {
        if (!session.token) await showWelcome(chatId, session);
        else await showMain(chatId, session, null);
        return;
      }
      if (cmd === '/login') { await askUsername(chatId); return; }
      if (cmd === '/logout') { clearLogin(session); sessions.delete(chatId); await send(chatId, '👋 تم تسجيل الخروج.', welcomeKeyboard(null)); return; }
      if (cmd === '/servers') { if (session.token) await showServers(chatId, session, null); else await askUsername(chatId); return; }
      if (cmd === '/status') { if (session.token && session.activeBotId) await showStatus(chatId, session, null); else await showMain(chatId, session, null); return; }
      if (cmd === '/files') { if (session.token && session.activeBotId) await showListing(chatId, session, session.curDir || '', null); else await showMain(chatId, session, null); return; }
      await showMain(chatId, session, null);
      return;
    }

    // plain text: guide the user with buttons
    if (!session.token) await askUsername(chatId);
    else await showMain(chatId, session, null);
  }

  // ====== Poll loop ======
  async function processUpdate(update) {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  }

  async function pollOnce() {
    const qs = new URLSearchParams({
      timeout: String(POLL_TIMEOUT),
      offset: String(offset),
      allowed_updates: JSON.stringify(['message', 'callback_query']),
    });
    const res = await fetch(`${API_BASE}/bot${token}/getUpdates?${qs}`, { signal: AbortSignal.timeout((POLL_TIMEOUT + 15) * 1000) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || 'getUpdates failed');
    for (const update of data.result || []) {
      offset = update.update_id + 1;
      try { await processUpdate(update); } catch (err) { console.error('Telegram update error:', err.message); }
    }
  }

  async function start() {
    if (running) return;
    try { botInfo = await tg('getMe'); } catch (err) { console.error('Telegram getMe failed:', err.message); }
    try {
      const last = await tg('getUpdates', { offset: -1, limit: 1 });
      if (Array.isArray(last) && last.length) offset = last[last.length - 1].update_id + 1;
    } catch (_) { /* ignore */ }
    running = true;
    console.log(`🤖 Telegram bot active${botInfo.username ? ' (@' + botInfo.username + ')' : ''}`);
    (async () => {
      while (running) {
        try { await pollOnce(); }
        catch (err) {
          if (running) { console.error('Telegram poll error:', err.message); await new Promise(r => setTimeout(r, 4000)); }
        }
      }
    })();
  }

  function stop() { running = false; }

  return {
    start,
    stop,
    getUsername: () => botInfo.username || '',
    getBotInfo: () => botInfo,
  };
}

module.exports = { createTelegramBot };
