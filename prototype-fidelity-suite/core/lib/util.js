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

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
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
  ensureDir, readJson, writeJson, exists, canonicalJson, sha256, sha256File,
  relPosix, isoNow, slug, round, clamp, idOf, log, PfError,
};
