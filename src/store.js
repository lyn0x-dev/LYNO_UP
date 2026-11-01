'use strict';
// قراءة/كتابة users.json و bots.json بأمان (كتابة ذرية + نسخة احتياطية)
const path = require('path');
const crypto = require('crypto');
const fs = require('fs-extra');
const state = require('./state');
const { USERS_FILE, DB_FILE } = require('./config');
const { isValidBotId } = require('./utils');

async function readStore(file) {
  const bak = file + '.bak';
  const tryRead = async (f) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const data = await fs.readJson(f);
        if (Array.isArray(data)) return data;
      } catch (_) { /* retry */ }
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
    return null;
  };
  if (await fs.pathExists(file)) {
    const data = await tryRead(file);
    if (data) return data;
    console.error(`WARNING: ${path.basename(file)} is unreadable, trying backup`);
    await fs.copy(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
  }
  if (await fs.pathExists(bak)) {
    const data = await tryRead(bak);
    if (data) { console.error(`Restored ${path.basename(file)} from backup`); return data; }
  }
  if (await fs.pathExists(file)) throw new Error(`${path.basename(file)} is corrupt and no valid backup exists`);
  return [];
}

async function writeStore(file, data) {
  const tmpFile = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeJson(tmpFile, data, { spaces: 2 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(tmpFile, file);
      await fs.copy(file, file + '.bak', { overwrite: true }).catch(() => {});
      return;
    } catch (err) {
      if (attempt === 4) { await fs.remove(tmpFile).catch(() => {}); throw err; }
      await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

// ====== Users store ======
let usersQueue = Promise.resolve();

async function loadUsers() { return readStore(USERS_FILE); }

async function saveUsers(users) { return writeStore(USERS_FILE, users); }

function withUsers(mutator) {
  const run = usersQueue.then(async () => {
    const users = await loadUsers();
    const result = await mutator(users);
    await saveUsers(users);
    state.users = users;
    return result;
  });
  usersQueue = run.catch(() => {});
  return run;
}

function publicUser(user) {
  const out = {
    id: user.id,
    username: user.username,
    role: user.role,
    maxBots: user.maxBots || 0,
    suspended: Boolean(user.suspended),
    createdAt: user.createdAt,
  };
  if (user.role === 'server') out.botId = user.botId;
  return out;
}

// ====== Bots store ======
// botOwners مجرد فهرس سريع (botId -> ownerId) بنستخدمه عشان رسائل الـ WebSocket
// تروح بس لصاحب السيرفر والأدمن.
function indexOwners(bots) {
  state.botOwners = new Map(bots.map(b => [b.id, b.ownerId]));
  return bots;
}

async function loadBots() { return indexOwners(await readStore(DB_FILE)); }

async function saveBots(bots) { await writeStore(DB_FILE, bots); indexOwners(bots); }

let dbQueue = Promise.resolve();

function withDb(mutator) {
  const run = dbQueue.then(async () => {
    const bots = await loadBots();
    const result = await mutator(bots);
    await saveBots(bots);
    return result;
  });
  dbQueue = run.catch(() => {});
  return run;
}

async function getBotById(id) {
  if (!isValidBotId(id)) return null;
  const bots = await loadBots();
  return bots.find(b => b.id === id) || null;
}

module.exports = {
  readStore, writeStore,
  loadUsers, saveUsers, withUsers, publicUser,
  loadBots, saveBots, withDb, getBotById,
};
