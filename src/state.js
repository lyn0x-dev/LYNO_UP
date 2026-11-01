'use strict';
// حالة مشتركة بين الملفات (بدل المتغيرات العامة اللي كانت في server.js)
module.exports = {
  users: [],            // نسخة في الذاكرة من users.json
  botOwners: new Map(), // botId -> ownerId (لفلترة رسائل الـ WebSocket)
  shuttingDown: false,
  telegramBot: null,
  frontServer: null,
};
