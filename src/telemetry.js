'use strict';
// قياس CPU / الذاكرة / الشبكة لكل سيرفر شغال (بيبعت كل ثانيتين عبر WebSocket)
const fs = require('fs-extra');
const { execFile } = require('child_process');

// CPU/memory are summed over the whole process tree of each server. Network is
// measured system-wide (Linux exposes no reliable per-process counters).
const CLK_TCK = 100;
const PAGE_SIZE = 4096;
let lastNetSample = null;
let statsSampling = false;

function readLinuxProcessTable() {
  const table = new Map();
  let names;
  try { names = fs.readdirSync('/proc'); } catch (_) { return table; }
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const end = stat.lastIndexOf(')');
      if (end === -1) continue;
      const parts = stat.slice(end + 2).trim().split(/\s+/);
      const pid = parseInt(name, 10);
      const ppid = parseInt(parts[1], 10);
      const cpuMs = ((parseInt(parts[11], 10) + parseInt(parts[12], 10)) / CLK_TCK) * 1000;
      let rss = 0;
      try {
        const statm = fs.readFileSync(`/proc/${name}/statm`, 'utf8').trim().split(/\s+/);
        rss = (parseInt(statm[1], 10) || 0) * PAGE_SIZE;
      } catch (_) { /* process vanished */ }
      table.set(pid, { ppid, cpuMs: Number.isFinite(cpuMs) ? cpuMs : 0, rss });
    } catch (_) { /* process vanished */ }
  }
  return table;
}

function readWindowsProcessTable() {
  return new Promise(resolve => {
    execFile(
      'wmic',
      ['process', 'get', 'ProcessId,ParentProcessId,WorkingSetSize,UserModeTime,KernelModeTime', '/format:csv'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          try {
            const lines = stdout.split(/\r?\n/).filter(l => l.trim());
            const header = lines[0].split(',').map(h => h.trim().toLowerCase());
            const find = (name) => header.indexOf(name);
            const iKernel = find('kernelmodetime');
            const iParent = find('parentprocessid');
            const iProc = find('processid');
            const iUser = find('usermodetime');
            const iWorking = find('workingsetsize');
            if (iKernel !== -1 && iParent !== -1 && iProc !== -1 && iUser !== -1) {
              const table = new Map();
              for (let i = 1; i < lines.length; i += 1) {
                const cols = lines[i].split(',');
                const pid = parseInt(cols[iProc], 10);
                if (!Number.isFinite(pid)) continue;
                table.set(pid, {
                  ppid: parseInt(cols[iParent], 10),
                  cpuMs: ((parseInt(cols[iUser], 10) || 0) + (parseInt(cols[iKernel], 10) || 0)) / 10000,
                  rss: parseInt(cols[iWorking], 10) || 0,
                });
              }
              return resolve(table);
            }
          } catch (_) { /* fall through to PowerShell */ }
        }
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,UserModeTime,KernelModeTime | ConvertTo-Json -Compress'],
          { windowsHide: true, timeout: 10000 },
          (err2, out2) => {
            if (err2 || !out2) return resolve(null);
            try {
              let rows = JSON.parse(out2);
              if (!Array.isArray(rows)) rows = [rows];
              const table = new Map();
              for (const row of rows) {
                const pid = Number(row.ProcessId);
                if (!Number.isFinite(pid)) continue;
                table.set(pid, {
                  ppid: Number(row.ParentProcessId),
                  cpuMs: ((Number(row.UserModeTime) || 0) + (Number(row.KernelModeTime) || 0)) / 10000,
                  rss: Number(row.WorkingSetSize) || 0,
                });
              }
              resolve(table);
            } catch (_) { resolve(null); }
          },
        );
      },
    );
  });
}

async function readProcessTable() {
  if (process.platform === 'linux') return readLinuxProcessTable();
  if (process.platform === 'win32') return readWindowsProcessTable();
  return null;
}

function readNetworkTotals() {
  if (process.platform !== 'linux') return null;
  try {
    let rx = 0;
    let tx = 0;
    for (const line of fs.readFileSync('/proc/net/dev', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*[^:]+:\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
      if (m) {
        rx += parseInt(m[1], 10);
        tx += parseInt(m[2], 10);
      }
    }
    return { rx, tx };
  } catch (_) { return null; }
}

function buildChildrenMap(table) {
  const children = new Map();
  for (const [pid, info] of table) {
    if (!children.has(info.ppid)) children.set(info.ppid, []);
    children.get(info.ppid).push(pid);
  }
  return children;
}

function sumProcessTree(table, children, rootPid) {
  let rss = 0;
  let cpuMs = 0;
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const info = table.get(pid);
    if (!info) continue;
    rss += info.rss;
    cpuMs += info.cpuMs;
    const kids = children.get(pid);
    if (kids) for (const kid of kids) stack.push(kid);
  }
  return { rss, cpuMs };
}

function startTelemetry({ runningBots, prevStats, broadcast, memoryMb }) {
async function sampleBotStats() {
  if (statsSampling) return;
  statsSampling = true;
  try {
    if (!runningBots.size) {
      prevStats.clear();
      lastNetSample = null;
      return;
    }
    const now = Date.now();
    const table = await readProcessTable();
    const children = table ? buildChildrenMap(table) : null;
    const netNow = readNetworkTotals();
    let netIn = null;
    let netOut = null;
    if (netNow && lastNetSample && now > lastNetSample.time) {
      const seconds = (now - lastNetSample.time) / 1000;
      netIn = Math.max(0, (netNow.rx - lastNetSample.rx) / seconds);
      netOut = Math.max(0, (netNow.tx - lastNetSample.tx) / seconds);
    }
    if (netNow) lastNetSample = { ...netNow, time: now };
    const memoryLimit = memoryMb * 1024 * 1024;
    for (const [botId, entry] of runningBots) {
      const pid = entry.process && entry.process.pid;
      if (!pid) continue;
      const totals = table ? sumProcessTree(table, children, pid) : null;
      let cpu = null;
      if (totals) {
        const prev = prevStats.get(botId);
        cpu = prev && now > prev.time
          ? Math.max(0, ((totals.cpuMs - prev.cpuMs) / (now - prev.time)) * 100)
          : 0;
        prevStats.set(botId, { cpuMs: totals.cpuMs, time: now });
      }
      broadcast({
        type: 'stats',
        botId,
        cpu,
        memory: totals ? totals.rss : null,
        memoryLimit,
        netIn,
        netOut,
      });
    }
  } catch (_) {
    // Telemetry must never take the panel down.
  } finally {
    statsSampling = false;
  }
}

  setInterval(sampleBotStats, 2000).unref();
}

module.exports = { startTelemetry };
