'use strict';
/**
 * Static file server for the DNA walker.
 *
 * `file://` blocks `document.styleSheets[i].cssRules` with a SecurityError in
 * Chromium, which would hide every *declared* value (custom properties, literal
 * colours, override order). Serving the prototype over loopback keeps the
 * page untouched while making the CSSOM readable — the boundary is the
 * browser's, not ours, so we work with it instead of guessing from computed
 * styles alone.
 *
 * No dependencies, ephemeral port, bound to 127.0.0.1 only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

function startServer(root, opts) {
  const base = path.resolve(root);
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel;
      try {
        rel = decodeURIComponent(String(req.url || '/').split('?')[0]);
      } catch (_) {
        res.writeHead(400); res.end('bad url'); return;
      }
      const file = path.join(base, rel === '/' ? '/index.html' : rel);
      // Refuse anything that escapes the prototype directory.
      if (!path.resolve(file).startsWith(base)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
          'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(buf);
      });
    });
    server.once('error', reject);
    server.listen(o.port || 0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}

module.exports = { startServer };
