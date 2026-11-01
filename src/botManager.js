'use strict';
// تشغيل وإيقاف السيرفرات (العمليات) + اللوجات + إعادة التشغيل التلقائي
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const state = require('./state');
const {
  BOTS_DIR, BOT_MEMORY_MB, MAX_RUNNING_BOTS,
  AUTO_RESTART_MAX, AUTO_RESTART_BASE_MS, AUTO_RESTART_MAX_DELAY_MS, AUTO_RESTART_RESET_MS,
} = require('./config');
const { safePath, sanitizeEnv } = require('./utils');
const { broadcast } = require('./ws');
const { getBotById } = require('./store');
const { startTelemetry } = require('./telemetry');

const runningBots = new Map();
const pendingRestarts = new Map();
const prevStats = new Map();
const logStore = new Map();

function getBotPath(botId) {
  return path.join(BOTS_DIR, botId);
}

const INHERITED_ENV_KEYS = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'TZ'];

function buildBotEnv(bot) {
  const env = {};
  for (const key of INHERITED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, sanitizeEnv(bot.env));
  env.NODE_ENV = process.env.NODE_ENV || 'production';
  return env;
}

function getBotStatus(botId) {
  const entry = runningBots.get(botId);
  if (entry) return entry.status;
  if (pendingRestarts.has(botId)) return 'restarting';
  return 'stopped';
}

function getBotLogs(botId, limit = 100) {
  const entry = runningBots.get(botId);
  const logs = entry ? entry.logs : (logStore.get(botId) || []);
  return logs.slice(-limit);
}

function appendBotLog(botId, text, type = 'out') {
  const entry = runningBots.get(botId);
  const logs = entry ? entry.logs : logStore.get(botId);
  if (logs) {
    logs.push({ time: Date.now(), type, text });
    while (logs.length > 500) logs.shift();
  } else {
    const arr = [{ time: Date.now(), type, text }];
    logStore.set(botId, arr);
  }
  broadcast({ type: 'log', botId, line: text, stream: type });
}

async function startBot(bot, options = {}) {
  const restartAttempts = Number.isInteger(options.restartAttempts) ? options.restartAttempts : 0;
  if (!options.fromAutoRestart) cancelPendingRestart(bot.id);
  if (runningBots.has(bot.id)) {
    return { success: false, error: 'السيرفر يعمل بالفعل' };
  }
  if (runningBots.size >= MAX_RUNNING_BOTS) {
    return { success: false, error: `وصلت للحد الأقصى (${MAX_RUNNING_BOTS} سيرفرات شغالة)` };
  }

  const botPath = getBotPath(bot.id);
  const mainFile = safePath(botPath, bot.mainFile || 'index.js');
  if (!mainFile) {
    return { success: false, error: 'الملف الرئيسي غير صالح' };
  }
  if (!await fs.pathExists(mainFile)) {
    return { success: false, error: 'ملف السيرفر الرئيسي غير موجود' };
  }

  const child = spawn(process.execPath, [`--max-old-space-size=${BOT_MEMORY_MB}`, mainFile], {
    cwd: botPath,
    env: buildBotEnv(bot),
    detached: process.platform !== 'win32',
    windowsHide: true,
  });

  const entry = {
    process: child,
    // إعادة التشغيل التلقائي بتكمّل على نفس اللوجات (عشان رسائل [panel] ما تضيعش)
    logs: options.fromAutoRestart ? (logStore.get(bot.id) || []) : [],
    status: 'running',
    killTimer: null,
    finished: false,
    manualStop: false,
    restartAttempts,
    startedAt: Date.now(),
    stableTimer: null,
  };
  entry.stableTimer = setTimeout(() => {
    entry.restartAttempts = 0;
  }, AUTO_RESTART_RESET_MS);
  if (entry.stableTimer.unref) entry.stableTimer.unref();
  const maxLogs = 500;
  logStore.set(bot.id, entry.logs);
  prevStats.delete(bot.id);

  child.stdout.on('data', (data) => {
    const line = data.toString();
    entry.logs.push({ time: Date.now(), type: 'out', text: line });
    if (entry.logs.length > maxLogs) entry.logs.shift();
    broadcast({ type: 'log', botId: bot.id, line, stream: 'out' });
  });

  child.stderr.on('data', (data) => {
    const line = data.toString();
    entry.logs.push({ time: Date.now(), type: 'err', text: line });
    if (entry.logs.length > maxLogs) entry.logs.shift();
    broadcast({ type: 'log', botId: bot.id, line, stream: 'err' });
  });

  // Idempotent cleanup: 'exit' fires even when grandchildren keep the stdio pipes
  // open (in which case 'close' never fires and the status would stay 'stopping').
  const finish = (status, extra = {}) => {
    if (entry.finished) return;
    entry.finished = true;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    if (entry.stableTimer) clearTimeout(entry.stableTimer);
    if (runningBots.get(bot.id) === entry) runningBots.delete(bot.id);
    prevStats.delete(bot.id);
    broadcast({ type: 'status', botId: bot.id, status, ...extra });
    if (!entry.manualStop && !state.shuttingDown && bot.autoRestart !== false) {
      scheduleAutoRestart(bot, entry.restartAttempts || 0);
    }
  };
  entry.finish = finish;

  child.stdout.on('error', () => {});
  child.stderr.on('error', () => {});
  child.on('exit', (code) => finish('stopped', { code }));
  child.on('close', (code) => finish('stopped', { code }));
  child.on('error', (err) => {
    entry.logs.push({ time: Date.now(), type: 'err', text: `Process error: ${err.message}\n` });
    finish('error', { error: err.message });
  });

  runningBots.set(bot.id, entry);
  broadcast({ type: 'status', botId: bot.id, status: 'running' });
  return { success: true };
}

function killTree(entry, signal) {
  const child = entry.process;
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    } else {
      try { process.kill(-child.pid, signal); } catch (_) { child.kill(signal); }
    }
  } catch (_) { /* already dead */ }
}

function stopBot(botId) {
  if (cancelPendingRestart(botId)) {
    broadcast({ type: 'status', botId, status: 'stopped' });
    return { success: true };
  }
  const entry = runningBots.get(botId);
  if (!entry) return { success: false, error: 'السيرفر لا يعمل' };
  if (entry.status === 'stopping') return { success: true };

  entry.manualStop = true;
  entry.status = 'stopping';
  broadcast({ type: 'status', botId, status: 'stopping' });

  killTree(entry, 'SIGTERM');

  entry.killTimer = setTimeout(() => {
    if (entry.finished) return;
    killTree(entry, 'SIGKILL');
    // Last resort: never leave the server stuck in "stopping".
    entry.killTimer = setTimeout(() => entry.finish && entry.finish('stopped', { code: null }), 2000);
    if (entry.killTimer.unref) entry.killTimer.unref();
  }, 5000);
  if (entry.killTimer.unref) entry.killTimer.unref();

  return { success: true };
}

async function forceStopBot(botId) {
  cancelPendingRestart(botId);
  const entry = runningBots.get(botId);
  if (!entry) return;
  entry.manualStop = true;
  if (entry.killTimer) clearTimeout(entry.killTimer);
  entry.status = 'stopping';
  const exited = new Promise(resolve => entry.process.once('exit', resolve));
  killTree(entry, 'SIGKILL');
  await Promise.race([
    exited,
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  // Even if the OS didn't report the exit in time, free the slot so start/restart work.
  if (entry.finish) entry.finish('stopped', { code: null });
}

function cancelPendingRestart(botId) {
  const pending = pendingRestarts.get(botId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingRestarts.delete(botId);
  return true;
}

function scheduleAutoRestart(bot, attempts) {
  if (state.shuttingDown || AUTO_RESTART_MAX <= 0) return;
  if (attempts >= AUTO_RESTART_MAX) {
    appendBotLog(bot.id, `\n[panel] توقفت إعادة التشغيل التلقائي بعد ${attempts} محاولة.\n`, 'err');
    broadcast({ type: 'status', botId: bot.id, status: 'error' });
    return;
  }
  const next = attempts + 1;
  const delay = Math.min(AUTO_RESTART_MAX_DELAY_MS, AUTO_RESTART_BASE_MS * Math.pow(2, attempts));
  const timer = setTimeout(async () => {
    pendingRestarts.delete(bot.id);
    if (state.shuttingDown) return;
    appendBotLog(bot.id, `\n[panel] إعادة تشغيل تلقائية (${next}/${AUTO_RESTART_MAX})...\n`, 'out');
    // نقرا نسخة السيرفر الحالية من قاعدة البيانات (ممكن اتعدّلت أو اتحذفت من ساعة ما اشتغل)
    const fresh = await getBotById(bot.id).catch(() => null);
    if (!fresh) return;
    if (fresh.autoRestart === false) {
      broadcast({ type: 'status', botId: bot.id, status: 'stopped' });
      return;
    }
    const result = await startBot(fresh, { restartAttempts: next, fromAutoRestart: true });
    if (!result.success) {
      appendBotLog(bot.id, `[panel] فشل إعادة التشغيل: ${result.error}\n`, 'err');
      scheduleAutoRestart(fresh, next);
    }
  }, delay);
  if (timer.unref) timer.unref();
  pendingRestarts.set(bot.id, { timer, attempts: next });
  broadcast({ type: 'status', botId: bot.id, status: 'restarting', attempt: next, max: AUTO_RESTART_MAX, delay });
  appendBotLog(bot.id, `\n[panel] توقف غير متوقع — إعادة التشغيل خلال ${Math.max(1, Math.round(delay / 1000))} ثانية (${next}/${AUTO_RESTART_MAX}).\n`, 'err');
}

function cancelAllRestarts() {
  for (const botId of [...pendingRestarts.keys()]) cancelPendingRestart(botId);
}

function killAllBots() {
  for (const [, entry] of runningBots) {
    entry.manualStop = true;
    killTree(entry, 'SIGKILL');
  }
}

startTelemetry({ runningBots, prevStats, broadcast, memoryMb: BOT_MEMORY_MB });

module.exports = {
  runningBots, getBotPath, buildBotEnv, getBotStatus, getBotLogs, appendBotLog,
  startBot, stopBot, forceStopBot, cancelAllRestarts, killAllBots, killTree,
};
