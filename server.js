/* CSP dashboard server — zero-dependency.
   Serves static files + proxies /api/* to api.openalex.org with the key from
   OPENALEX_API_KEY (env). The key never reaches the browser. */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
let KEY = process.env.OPENALEX_API_KEY || '';
if (!KEY) {
  // local dev convenience: read the key from ../openalex-walden/.env (never in this repo)
  try {
    const env = fs.readFileSync(path.join(ROOT, '..', 'openalex-walden', '.env'), 'utf8');
    const m = env.match(/^OPENALEX_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) KEY = m[1];
  } catch (e) { /* no local .env — run anonymous */ }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// tiny TTL cache for proxy responses (10 min, max 500 entries)
const cache = new Map();
const TTL = 10 * 60 * 1000;

function fromCache(k) {
  const e = cache.get(k);
  if (e && Date.now() - e.t < TTL) return e.body;
  if (e) cache.delete(k);
  return null;
}

function toCache(k, body) {
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  cache.set(k, { t: Date.now(), body });
}

function proxy(req, res) {
  const target = req.url.replace(/^\/api/, '');
  const cached = fromCache(target);
  if (cached) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT' });
    return res.end(cached);
  }
  const headers = { 'User-Agent': 'csp-dashboard (kyle@ourresearch.org)' };
  if (KEY) headers.Authorization = `Bearer ${KEY}`;
  https.get('https://api.openalex.org' + target, { headers }, (up) => {
    const chunks = [];
    up.on('data', (c) => chunks.push(c));
    up.on('end', () => {
      const body = Buffer.concat(chunks);
      if (up.statusCode === 200) toCache(target, body);
      res.writeHead(up.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
    });
  }).on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e) }));
  });
}

http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxy(req, res);
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || p.startsWith('/build') || p.startsWith('/data-raw') ||
      p.includes('.env') || p.startsWith('/.git')) {
    res.writeHead(404); return res.end('not found');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`csp-dashboard on :${PORT} (key ${KEY ? 'set' : 'MISSING — anonymous proxy'})`));
