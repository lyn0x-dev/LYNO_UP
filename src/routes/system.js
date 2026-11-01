'use strict';
const os = require('os');
const state = require('../state');
const { PORT, PLATFORM_URL, BRAND_NAME, MAX_RUNNING_BOTS, BOT_MEMORY_MB, UPLOAD_MAX_MB } = require('../config');
const { safeRouter } = require('../utils');
const { runningBots } = require('../botManager');

const router = safeRouter();

// System info
router.get('/api/system', (req, res) => {
  const payload = {
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    nodeVersion: process.version,
    runningBots: runningBots.size,
    limits: {
      maxRunningBots: MAX_RUNNING_BOTS,
      botMemoryMb: BOT_MEMORY_MB,
      uploadMaxMb: UPLOAD_MAX_MB,
    },
  };
  if (req.user.role === 'admin') payload.userCount = state.users.length;
  res.json(payload);
});

// Platform info (auto-detect current domain)
router.get('/api/platform', (req, res) => {
  res.json({
    url: PLATFORM_URL,
    name: BRAND_NAME,
    panelUrl: `${req.protocol}://${req.get('host')}`,
    port: PORT,
    telegram: state.telegramBot ? (state.telegramBot.getUsername() || true) : null,
  });
});

module.exports = router;
