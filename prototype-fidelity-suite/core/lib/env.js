'use strict';
/**
 * Environment capability detection.
 *
 * Every capability is reported with the evidence used to decide it. A capability
 * that cannot be proven is `unverified`, never `available` — the acceptance
 * statuses downstream inherit that rule (missing evidence must not read as PASS).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

const MIN_NODE_MAJOR = 18;

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE_PATH,
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'playwright'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright'),
  '/usr/local/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright',
  '/opt/homebrew/lib/node_modules/playwright',
  '/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright',
];

const AUTOMATOR_CANDIDATES = [
  process.env.MINIPROGRAM_AUTOMATOR_PATH,
  path.join(os.tmpdir(), 'opencode', 'mp-auto', 'node_modules', 'miniprogram-automator'),
  path.join(os.tmpdir(), 'mp-auto', 'node_modules', 'miniprogram-automator'),
];

const WECHAT_CLI_CANDIDATES = [
  process.env.WECHAT_DEVTOOLS_CLI,
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
];

function firstExisting(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      const p = c.endsWith('.js') || c.endsWith('.json') ? c : path.join(c, 'package.json');
      if (fs.existsSync(p)) return c;
    } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * `pkg.main` may be extensionless (`./out/index`), so join+existsSync is not a
 * valid entry check — it reports "missing" for a package Node itself loads fine.
 * Resolve through Node's own algorithm, then fall back to common layouts.
 */
function loadModule(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const req = createRequire(path.join(dir, 'noop.js'));
    const tries = [pkg.main, './index.js', './out/index.js', './lib/index.js'].filter(Boolean);
    let lastErr = null;
    for (const t of tries) {
      try {
        const entry = req.resolve(t);
        return { ok: true, version: pkg.version || 'unknown', entry };
      } catch (e) { lastErr = e; }
    }
    return { ok: false, reason: `package.json found but no resolvable entry (${lastErr && lastErr.code})` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function npmRootG() {
  try {
    return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    return null;
  }
}

function detectPlaywright(opts) {
  const useNpm = !opts || opts.useNpm !== false;
  const dirs = PLAYWRIGHT_CANDIDATES.slice();
  if (useNpm) {
    const root = npmRootG();
    if (root) {
      dirs.push(path.join(root, 'playwright'), path.join(root, '@playwright', 'cli', 'node_modules', 'playwright'));
    }
  }
  const dir = firstExisting(dirs);
  if (!dir) return { status: 'missing', searched: dirs.filter(Boolean) };
  const mod = loadModule(dir);
  if (!mod.ok) return { status: 'missing', searched: dirs.filter(Boolean), reason: mod.reason };
  return { status: 'available', path: dir, version: mod.version };
}

function detectAutomator() {
  const dirs = AUTOMATOR_CANDIDATES.slice();
  const envPath = process.env.NODE_PATH;
  if (envPath) {
    for (const p of envPath.split(path.delimiter)) {
      if (p) dirs.push(path.join(p, 'miniprogram-automator'));
    }
  }
  const dir = firstExisting(dirs);
  if (!dir) return { status: 'missing', searched: dirs.filter(Boolean) };
  const mod = loadModule(dir);
  if (!mod.ok) return { status: 'missing', searched: dirs.filter(Boolean), reason: mod.reason };
  return { status: 'available', path: dir, version: mod.version };
}

function detectWechatCli() {
  for (const c of WECHAT_CLI_CANDIDATES) {
    if (c && fs.existsSync(c)) return { status: 'available', path: c };
  }
  return { status: 'missing', searched: WECHAT_CLI_CANDIDATES.filter(Boolean) };
}

/** TCP probe; a refused connection proves the port is closed, a timeout does not. */
function probePort(port, host, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = net.connect({ port, host });
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ...result, port, host, ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs || 1500);
    socket.once('connect', () => finish({ status: 'open' }));
    socket.once('timeout', () => finish({ status: 'unverified', reason: 'timeout' }));
    socket.once('error', e => finish({ status: 'closed', reason: e.code || e.message }));
  });
}

async function detectDevtoolsPorts(ports, opts) {
  const list = (ports || [33278]).map(p => Number(p));
  const results = await Promise.all(list.map(p => probePort(p, (opts && opts.host) || '127.0.0.1', opts && opts.timeoutMs)));
  return {
    status: results.some(r => r.status === 'open') ? 'available'
      : results.every(r => r.status === 'closed') ? 'closed' : 'unverified',
    ports: results,
  };
}

function nodeStatus() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    status: major >= MIN_NODE_MAJOR ? 'available' : 'unsupported',
    version: process.versions.node,
    required: `>=${MIN_NODE_MAJOR}`,
  };
}

/** Full picture, cheap probes only. Port probing is opt-in via `ports`. */
async function detect(opts) {
  const o = opts || {};
  const report = {
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    node: nodeStatus(),
    capabilities: {
      playwright: detectPlaywright({ useNpm: o.useNpm }),
      automator: detectAutomator(),
      wechatCli: detectWechatCli(),
    },
  };
  if (o.ports && o.ports.length) {
    report.capabilities.devtoolsPorts = await detectDevtoolsPorts(o.ports, o);
  }
  return report;
}

module.exports = {
  detect, detectPlaywright, detectAutomator, detectWechatCli, detectDevtoolsPorts,
  probePort, nodeStatus,
};
