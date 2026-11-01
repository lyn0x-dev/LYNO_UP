'use strict';
// ============================================================
// الإعدادات المركزية — كل الأرقام والمتغيرات في مكان واحد.
// القيم بتتقرا من ملف .env (شوف .env.example) ولو مش موجودة بتاخد الافتراضي.
// ============================================================
const path = require('path');
const fs = require('fs-extra');

const ROOT_DIR = path.join(__dirname, '..');

// ====== Load .env (manual, no extra dependency) ======
function loadEnvFile() {
  try {
    const envPath = path.join(ROOT_DIR, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(m[1] in process.env) || process.env[m[1]] === '') process.env[m[1]] = value;
    }
  } catch (_) { /* ignore */ }
}
loadEnvFile();

// ====== Branding (اسم اللوحة) ======
const BRAND_NAME = process.env.BRAND_NAME || 'LYNO UP Control';

// ====== Network ======
const PORT = parseInt(process.env.PORT, 10) || 24691;
const HOST = process.env.HOST || '0.0.0.0';
const PLATFORM_URL = process.env.PLATFORM_URL || 'https://lynox.duckdns.org';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
const DISABLE_HTTPS = process.env.DISABLE_HTTPS === '1';
const TLS_DIR = path.join(ROOT_DIR, '.tls');

// ====== Data locations ======
// DATA_DIR lets you keep users/servers data outside the app folder so redeploying the code never wipes it
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DIR;
fs.ensureDirSync(DATA_DIR);
const BOTS_DIR = path.join(DATA_DIR, 'bots');
const DB_FILE = path.join(DATA_DIR, 'bots.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.session_secret');
const TMP_DIR = path.join(ROOT_DIR, 'tmp');

// ====== Limits ======
const MAX_RUNNING_BOTS = Math.max(1, parseInt(process.env.MAX_RUNNING_BOTS, 10) || 10);
const BOT_MEMORY_MB = Math.max(64, parseInt(process.env.BOT_MEMORY_MB, 10) || 256);
const SESSION_TTL_HOURS = Math.max(1, parseInt(process.env.SESSION_TTL_HOURS, 10) || 168);
const UPLOAD_MAX_MB = Math.max(1, parseInt(process.env.UPLOAD_MAX_MB, 10) || 50);
const MAX_EXTRACT_MB = Math.max(1, parseInt(process.env.MAX_EXTRACT_MB, 10) || 500);
const AUTO_RESTART_MAX_RAW = parseInt(process.env.AUTO_RESTART_MAX, 10);
const AUTO_RESTART_MAX = Number.isFinite(AUTO_RESTART_MAX_RAW) ? Math.max(0, AUTO_RESTART_MAX_RAW) : 5;
const AUTO_RESTART_BASE_MS = Math.max(250, parseInt(process.env.AUTO_RESTART_BASE_MS, 10) || 1000);
const AUTO_RESTART_MAX_DELAY_MS = 60 * 1000;
const AUTO_RESTART_RESET_MS = 60 * 1000;
const EDITOR_MAX_BYTES = 5 * 1024 * 1024;
const JSON_BODY_LIMIT = '3mb';

// ====== Telegram control bot ======
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_API_BASE = (process.env.TELEGRAM_API_BASE || '').trim();
const TELEGRAM_ALLOWED_IDS = String(process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(/[,\s]+/)
  .map(s => parseInt(s, 10))
  .filter(n => Number.isFinite(n) && n > 0);
const TELEGRAM_ENABLED = TELEGRAM_BOT_TOKEN.length > 0;

fs.ensureDirSync(BOTS_DIR);
fs.ensureDirSync(TMP_DIR);

module.exports = {
  ROOT_DIR, BRAND_NAME,
  PORT, HOST, PLATFORM_URL, PUBLIC_URL, DISABLE_HTTPS, TLS_DIR,
  DATA_DIR, BOTS_DIR, DB_FILE, USERS_FILE, SECRET_FILE, TMP_DIR,
  MAX_RUNNING_BOTS, BOT_MEMORY_MB, SESSION_TTL_HOURS, UPLOAD_MAX_MB, MAX_EXTRACT_MB,
  AUTO_RESTART_MAX, AUTO_RESTART_BASE_MS, AUTO_RESTART_MAX_DELAY_MS, AUTO_RESTART_RESET_MS,
  EDITOR_MAX_BYTES, JSON_BODY_LIMIT,
  TELEGRAM_BOT_TOKEN, TELEGRAM_API_BASE, TELEGRAM_ALLOWED_IDS, TELEGRAM_ENABLED,
};
