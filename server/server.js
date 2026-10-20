// Node server: serves the app's files and the account API. Only built-in modules, no frameworks.
//
//   npm start                      → http://localhost:3000 (accounts saved in quotes.db)
//   PORT=8080 DB=/data/q.db npm start
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountService } from '../src/accounts/service.js';
import { handleApi } from '../src/accounts/routes.js';
import { openStore } from './sqlite-store.js';
import { passwords, tokens } from './crypto.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const COOKIE = 'qj_session';
const MAX_BODY = 16 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
// Only these folders are served, so the database, tests and server code can't be downloaded
const PUBLIC = ['index.html', 'style.css', 'src', 'docs'];

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

/** A simple per-IP limit on login and sign-up requests, on top of the per-username lockout. */
export function ipLimiter({ max = 30, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return (ip) => {
    const t = now();
    const h = hits.get(ip);
    if (!h || t - h.start > windowMs) { hits.set(ip, { start: t, count: 1 }); return true; }
    h.count++;
    return h.count <= max;
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** HttpOnly: page scripts can't read the token. SameSite=Lax: other sites can't send it with their requests. */
export function sessionCookie(session, { secure = false } = {}) {
  const flags = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (session.clear) return `${COOKIE}=; ${flags}; Max-Age=0`;
  const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
  return `${COOKIE}=${encodeURIComponent(session.token)}; ${flags}; Max-Age=${maxAge}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const json = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

async function serveFile(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = normalize(join(ROOT, rel));
  rel = file.slice(ROOT.length).split(sep).join('/');
  const allowed = file.startsWith(ROOT) && PUBLIC.some((p) => rel === p || rel.startsWith(`${p}/`));
  try {
    if (!allowed || !(await stat(file)).isFile()) throw new Error('not found');
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

export function createApp({ dbPath = ':memory:', secureCookies = false } = {}) {
  const store = openStore(dbPath);
  const service = new AccountService({ store, passwords, tokens });
  const allowAuth = ipLimiter();
  const cleanup = setInterval(() => store.deleteExpiredSessions(Date.now()), 60 * 60 * 1000);
  cleanup.unref();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
      return serveFile(req, res);
    }

    const ip = req.socket.remoteAddress ?? '';
    try {
      if (req.method !== 'GET') {
        // Changes must come from this site as JSON: a form on another site can't send that without permission
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json') && req.method !== 'DELETE') {
          return send(res, 415, { error: 'Send JSON.' });
        }
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-site request blocked.' });
      }
      if ((url.pathname === '/api/login' || url.pathname === '/api/signup') && !allowAuth(ip)) {
        return send(res, 429, { error: 'Too many requests. Please wait a few minutes.' }, { 'Retry-After': '600' });
      }

      const body = req.method === 'POST' ? await readJson(req) : {};
      const token = parseCookies(req.headers.cookie)[COOKIE] ?? null;
      const result = await handleApi(service, { method: req.method, path: url.pathname, body, token, ip });
      const headers = {};
      if (result.session) headers['Set-Cookie'] = sessionCookie(result.session, { secure: secureCookies });
      if (result.status === 429 && result.body?.retryAfter) headers['Retry-After'] = String(result.body.retryAfter);
      send(res, result.status, result.body, headers);
    } catch (err) {
      send(res, err.status ?? 500, { error: err.status ? err.message : 'Something went wrong.' });
    }
  });

  server.on('close', () => { clearInterval(cleanup); store.close(); });
  return server;
}

// Start when run directly (not when imported by the tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  createApp({ dbPath: process.env.DB ?? join(ROOT, 'quotes.db'), secureCookies: process.env.COOKIE_SECURE === '1' })
    .listen(port, () => console.log(`Quote & Joke Generator: http://localhost:${port}`));
}
