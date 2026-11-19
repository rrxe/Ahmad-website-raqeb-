// RAQEEB production server: serves the built site (dist) and one tiny API used to create the main admin.
// Secrets come from the container's environment (Dokploy → Environment) and never reach the browser.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT || 80);
const CODE = process.env.ADMIN_SETUP_CODE || '';
const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
const secure = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin' };

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}

async function sb(path, opts = {}) {
  return fetch(SB_URL + path, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

let fails = 0, windowStart = 0;
async function bootstrap(body) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const full_name = String(body.full_name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  if (CODE.length < 10 || !SB_URL || !SB_KEY || !email || !password) return { admin: false };

  const r = await sb('/rest/v1/profiles?role=eq.admin&status=eq.active&select=id&limit=1');
  if (!r.ok) return { admin: false };
  if ((await r.json()).length > 0) return { admin: false };

  const now = Date.now();
  if (now - windowStart > 3600_000) { fails = 0; windowStart = now; }
  if (fails >= 10) return { admin: false };
  if (!safeEqual(password, CODE)) { fails++; return { admin: false }; }

  const c = await sb('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name, phone, role: 'teacher' } }) });
  const u = await c.json();
  if (!c.ok) return { admin: false, error: u.msg || u.message || u.error_description || 'تعذر إنشاء الحساب' };
  const p = await sb(`/rest/v1/profiles?id=eq.${u.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ role: 'admin', status: 'active' }) });
  if (!p.ok) { await sb(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' }); return { admin: false, error: 'تعذر ترقية الحساب إلى مدير' }; }
  return { admin: true };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10_000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/admin-bootstrap') {
      if (req.method !== 'POST') { res.writeHead(405, secure).end(); return; }
      const out = await bootstrap(await readBody(req)).catch(() => ({ admin: false }));
      res.writeHead(200, { ...secure, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(out));
      return;
    }
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) { res.writeHead(403, secure).end(); return; }
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
    catch {
      if (extname(file)) { res.writeHead(404, secure).end('Not found'); return; }
      file = join(root, 'index.html'); // SPA routes: / and /admin
    }
    const buf = await readFile(file);
    const cache = file.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { ...secure, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': cache }).end(buf);
  } catch { res.writeHead(500, secure).end('Server error'); }
});
server.listen(PORT, () => console.log(`RAQEEB listening on ${PORT}`));
