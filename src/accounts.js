'use strict';
// حسابات "السيرفر" (Subuser): يوزر وباسورد عشوائي لكل سيرفر
const crypto = require('crypto');
const state = require('./state');
const { withUsers } = require('./store');
const { hashPassword, encryptPw, randomPassword } = require('./auth');

function randomUsername() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const pool = letters + '0123456789';
  const len = 7 + crypto.randomInt(4);
  let out = letters[crypto.randomInt(letters.length)];
  for (let i = 1; i < len; i += 1) out += pool[crypto.randomInt(pool.length)];
  return out;
}

function uniqueServerUsername() {
  for (let i = 0; i < 60; i += 1) {
    const name = randomUsername();
    if (!state.users.some(u => u.username.toLowerCase() === name.toLowerCase())) return name;
  }
  return 'srv' + crypto.randomUUID().slice(0, 10);
}

async function createServerAccess(botId) {
  const username = uniqueServerUsername();
  const password = randomPassword();
  const user = {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    passwordEnc: encryptPw(password),
    role: 'server',
    botId,
    maxBots: 0,
    suspended: false,
    createdAt: Date.now(),
  };
  await withUsers(users => { users.push(user); });
  return { username, password };
}

async function removeServerAccessForBots(botIds) {
  const set = new Set(botIds);
  if (!set.size) return;
  await withUsers(users => {
    for (let i = users.length - 1; i >= 0; i -= 1) {
      if (users[i].role === 'server' && set.has(users[i].botId)) users.splice(i, 1);
    }
  });
}

module.exports = { uniqueServerUsername, createServerAccess, removeServerAccessForBots };
