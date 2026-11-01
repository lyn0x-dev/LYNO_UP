'use strict';
// اختبار شامل للوحة: node scripts/e2e.js  (أو npm test) — بيشغّل نسخة مؤقتة ببيانات مؤقتة
const { spawn } = require('child_process');
const WebSocket = require('ws');
const AdmZip = require('adm-zip');
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = require('path').join(require('os').tmpdir(), 'panel-e2e-data'); fs.rmSync(DATA, { recursive: true, force: true });
const PORT = 24777, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['index.js'], { cwd: ROOT, env: { ...process.env, PORT, ADMIN_PASSWORD: 'adminpass1', DISABLE_HTTPS: '1', DATA_DIR: DATA, AUTO_RESTART_BASE_MS: '250' }, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };

async function call(method, url, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let b;
  if (form) b = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
  const r = await fetch(BASE + url, { method, headers, body: b });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}
const login = async (u, p) => call('POST', '/api/auth/login', { body: { username: u, password: p } });

(async () => {
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/'); break; } catch (_) { await sleep(150); } }
  console.log('# auth');
  let r = await login('admin', 'adminpass1'); ok(r.status === 200 && r.data.token, 'admin login');
  const A = r.data.token;
  // failed logins: 10 fails then blocked; successes don't count
  for (let i = 0; i < 12; i++) await login('nobody', 'bad');
  r = await login('admin', 'adminpass1'); ok(r.status === 429, 'lockout after repeated failures', r.status);
  // (limit is per IP, so use a separate check for "success does not count" below by restarting later)

  console.log('# users + bots');
  r = await call('POST', '/api/users', { token: A, body: { username: 'alice', password: 'alicepass1' } }); ok(r.data.success, 'create user alice', r.data);
  r = await call('POST', '/api/users', { token: A, body: { username: 'bob', password: 'bobpass12' } }); ok(r.data.success, 'create user bob', r.data);
  // tokens (login blocked by IP lockout) -> mint via admin? use internal: restart not possible; so reuse admin token only and create sessions directly
  // create session tokens for alice/bob using server's secret
  const secret = fs.readFileSync(path.join(DATA, '.session_secret'), 'utf8').trim();
  const crypto = require('crypto');
  const users = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json')));
  const tok = name => { const u = users.find(x => x.username === name); const exp = Math.floor(Date.now() / 1000) + 3600; return `${u.id}.${exp}.${crypto.createHmac('sha256', secret).update(`${u.id}.${exp}`).digest('base64url')}`; };
  const AL = tok('alice'), BO = tok('bob');

  const mkBot = async (token, name, code) => {
    const fd = new FormData(); fd.append('name', name); fd.append('mainFile', 'index.js');
    fd.append('file', new Blob([code]), 'index.js');
    return call('POST', '/api/bots', { token, form: fd });
  };
  r = await mkBot(AL, 'alice-bot', "console.log('hello from alice'); setInterval(()=>console.log('tick'),500);"); ok(r.data.success, 'alice creates bot', r.data);
  const aliceBot = r.data.bot.id;
  r = await mkBot(BO, 'bob-bot', "console.log('bob secret log'); setInterval(()=>{},1000);"); ok(r.data.success, 'bob creates bot', r.data);
  const bobBot = r.data.bot.id;

  console.log('# websocket isolation');
  const msgs = { alice: [], bob: [], admin: [] };
  const open = (token, key) => new Promise(res => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${encodeURIComponent(token)}`); ws.on('message', m => msgs[key].push(JSON.parse(m.toString()))); ws.on('open', () => res(ws)); });
  const wsA = await open(AL, 'alice'), wsB = await open(BO, 'bob'), wsAd = await open(A, 'admin');
  r = await call('POST', `/api/bots/${aliceBot}/start`, { token: AL }); ok(r.data.success, 'alice starts bot', r.data);
  r = await call('POST', `/api/bots/${bobBot}/start`, { token: BO }); ok(r.data.success, 'bob starts bot', r.data);
  await sleep(1800);
  const seen = key => msgs[key].filter(m => m.botId).map(m => m.botId);
  ok(seen('alice').includes(aliceBot) && !seen('alice').includes(bobBot), 'alice only sees her own bot events', [...new Set(seen('alice'))]);
  ok(seen('bob').includes(bobBot) && !seen('bob').includes(aliceBot), 'bob only sees his own bot events', [...new Set(seen('bob'))]);
  ok(seen('admin').includes(aliceBot) && seen('admin').includes(bobBot), 'admin sees both');
  const logMsg = msgs.alice.find(m => m.type === 'log');
  ok(logMsg && logMsg.stream === 'out', 'log messages carry stream type', logMsg);

  console.log('# access control');
  r = await call('GET', `/api/bots/${aliceBot}/logs`, { token: BO }); ok(r.status === 403, 'bob cannot read alice logs', r.status);
  r = await call('GET', `/api/bots/${aliceBot}/logs`, { token: AL }); ok(r.data.logs.some(l => /hello from alice/.test(l.text)), 'alice reads her logs');
  r = await call('GET', '/api/nope', { token: A }); ok(r.status === 404 && r.data.error, 'unknown /api -> JSON 404', r);

  console.log('# files');
  const botDir = path.join(DATA, 'bots', aliceBot);
  fs.symlinkSync('/nonexistent/target', path.join(botDir, 'broken-link'));
  fs.mkdirSync(path.join(botDir, 'مجلد-عربي')); fs.writeFileSync(path.join(botDir, 'مجلد-عربي', 'a.txt'), 'x');
  r = await call('GET', `/api/bots/${aliceBot}/files`, { token: AL }); ok(r.status === 200 && Array.isArray(r.data), 'file list survives broken symlink', r);
  const dl = await fetch(BASE + `/api/bots/${aliceBot}/download/${encodeURIComponent('مجلد-عربي')}`, { headers: { Authorization: 'Bearer ' + AL } });
  ok(dl.status === 200 && /filename\*=UTF-8''/.test(dl.headers.get('content-disposition') || ''), 'folder download with Arabic name', [dl.status, dl.headers.get('content-disposition')]);
  r = await call('POST', `/api/bots/${aliceBot}/mkdir`, { token: AL, body: { path: 'sub/dir' } }); ok(r.data.success, 'mkdir');
  r = await call('PUT', `/api/bots/${aliceBot}/files/sub/dir/f.txt`, { token: AL, body: { content: 'hello' } }); ok(r.data.success, 'save file');
  r = await call('POST', `/api/bots/${aliceBot}/archive`, { token: AL, body: { paths: ['sub'], format: 'zip', dest: 'sub.zip' } }); ok(r.data.success, 'zip archive', r.data);
  r = await call('POST', `/api/bots/${aliceBot}/extract`, { token: AL, body: { file: 'sub.zip', dest: 'out' } }); ok(r.data.success && r.data.extracted >= 1, 'extract zip', r.data);
  ok(fs.existsSync(path.join(botDir, 'out/sub/dir/f.txt')), 'extracted content exists');
  r = await call('POST', `/api/bots/${aliceBot}/archive`, { token: AL, body: { paths: ['sub'], format: 'tar.gz', dest: 'sub.tgz' } }); ok(r.data.success, 'tar.gz archive', r.data);
  r = await call('POST', `/api/bots/${aliceBot}/extract`, { token: AL, body: { file: 'sub.tar.gz', dest: 'out2' } }); ok(r.data.success, 'extract tar.gz', r.data);

  console.log('# npm install arg-injection');
  for (const bad of ['--global', '-g', '--force', 'foo@1|calc', 'a b;ls']) {
    r = await call('POST', `/api/bots/${aliceBot}/install`, { token: AL, body: { packages: [bad] } });
    ok(r.status === 400, `rejects "${bad}"`, r);
  }

  console.log('# user admin');
  const srvAccess = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'))).find(u => u.role === 'server' && u.botId === aliceBot);
  r = await call('PUT', `/api/users/${srvAccess.id}`, { token: A, body: { role: 'admin' } });
  const after = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'))).find(u => u.id === srvAccess.id);
  ok(after.role === 'server', 'server-role account cannot be promoted via role edit', after.role);

  console.log('# auto restart');
  const fd = new FormData(); fd.append('name', 'crasher'); fd.append('mainFile', 'index.js'); fd.append('file', new Blob(["console.log('boot');process.exit(1)"]), 'index.js');
  r = await call('POST', '/api/bots', { token: AL, form: fd }); const crash = r.data.bot.id;
  await call('POST', `/api/bots/${crash}/start`, { token: AL });
  await sleep(2500);
  r = await call('GET', `/api/bots/${crash}/logs?limit=500`, { token: AL });
  const text = r.data.logs.map(l => l.text).join('');
  ok((text.match(/boot/g) || []).length >= 2 && /إعادة تشغيل/.test(text), 'auto-restart keeps earlier logs + panel messages', text.slice(0, 400));
  // edit mainFile of crasher to something that stays alive -> auto-restart must pick up fresh config
  await call('POST', `/api/bots/${crash}/stop`, { token: AL });

  console.log('# index.html reload without restart');
  const idxFile = path.join(ROOT, 'public/index.html'); const orig = fs.readFileSync(idxFile, 'utf8');
  fs.writeFileSync(idxFile, orig.replace('</body>', '<!--E2E-MARK--></body>'));
  r = await call('GET', '/'); ok(/E2E-MARK/.test(r.data), 'index.html edits show up immediately');
  fs.writeFileSync(idxFile, orig);

  console.log('# stop + kill');
  r = await call('POST', `/api/bots/${aliceBot}/stop`, { token: AL }); ok(r.data.success, 'stop');
  await sleep(800);
  r = await call('GET', `/api/bots/${aliceBot}`, { token: AL }); ok(r.data.status === 'stopped', 'status stopped', r.data.status);
  r = await call('POST', `/api/bots/${bobBot}/kill`, { token: BO }); ok(r.data.success, 'kill');
  r = await call('DELETE', `/api/bots/${bobBot}`, { token: BO }); ok(r.data.success, 'delete bot');

  wsA.close(); wsB.close(); wsAd.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (/unhandledRejection|uncaughtException/.test(slog)) console.log('SERVER LOG HAS UNHANDLED ERRORS:\n' + slog.slice(-1500));
  srv.kill('SIGTERM'); await sleep(300); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); console.log(slog.slice(-1500)); srv.kill('SIGKILL'); process.exit(2); });
