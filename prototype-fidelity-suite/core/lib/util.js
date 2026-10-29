'use strict';
/**
 * Small shared helpers. No third-party dependencies on purpose: the suite must
 * run inside a zero-npm-dependency repository and on any machine with Node >= 18.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Windows returns EPERM/EACCES/EBUSY/UNKNOWN when another process momentarily
 * holds a handle on the file being replaced — an antivirus scan of the file the
 * previous step just wrote, a viewer left open on a report, a search indexer.
 * Those clear on their own within milliseconds; treating them as "the capture
 * did not happen" produced a BLOCKED verdict that no reader could reproduce.
 * A lock that never clears still fails, with the original code, after the last
 * attempt, so this cannot mask a real permission problem either.
 */
const TRANSIENT_WRITE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'EAGAIN', 'UNKNOWN', 'EUNKNOWN']);

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const until = Date.now() + ms;
    while (Date.now() < until) { /* platform without SharedArrayBuffer */ }
  }
}

function writeFileRetry(file, data, opts) {
  const o = opts || {};
  const attempts = o.attempts == null ? 5 : o.attempts;
  const write = o.write || ((f, d) => fs.writeFileSync(f, d));
  const wait = o.wait || sleepSync;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      write(file, data);
      return { file, attempts: i + 1 };
    } catch (e) {
      last = e;
      if (!TRANSIENT_WRITE_CODES.has(e.code)) {
        e.attempts = i + 1;
        throw e;
      }
      if (i < attempts - 1) wait(Math.min(200, 20 * Math.pow(2, i)));
    }
  }
  last.attempts = attempts;
  throw last;
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  writeFileRetry(file, JSON.stringify(value, null, 2) + '\n');
  return file;
}

function exists(file) {
  try { fs.accessSync(file); return true; } catch (_) { return false; }
}

/** Stable JSON: object keys sorted, so equal payloads hash equally. */
function canonicalJson(value) {
  const walk = v => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function isoNow() {
  return new Date().toISOString();
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

function round(n, digits) {
  const p = Math.pow(10, digits == null ? 2 : digits);
  return Math.round(n * p) / p;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Deterministic short id for a measurement record. */
function idOf(prefix, ...parts) {
  const h = crypto.createHash('sha1').update(parts.map(String).join('|')).digest('hex').slice(0, 8);
  return prefix + '-' + h;
}

function log(...args) {
  console.log(...args);
}

class PfError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail || null;
  }
}

module.exports = {
  ensureDir, readJson, writeJson, writeFileRetry, sleepSync, exists, canonicalJson, sha256, sha256File,
  relPosix, isoNow, slug, round, clamp, idOf, log, PfError, TRANSIENT_WRITE_CODES,
};
