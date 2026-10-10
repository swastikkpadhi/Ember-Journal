import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, createHmac, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const ROOT = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
const MAX_BODY = 8 * 1024 * 1024;
const SESSION_MS = 12 * 60 * 60 * 1000;
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function assert(condition, status, message) { if (!condition) throw new HttpError(status, message); }
function validBase64(value, bytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64') === value && (!bytes || decoded.length === bytes);
}
function envelope(value) {
  assert(value && value.format === 1 && validBase64(value.iv, 12) && validBase64(value.ciphertext), 400, 'Invalid encrypted diary.');
  assert(Buffer.from(value.ciphertext, 'base64').length >= 16 && value.ciphertext.length <= 7 * 1024 * 1024, 413, 'The encrypted diary is too large or incomplete.');
  return JSON.stringify({ format: 1, iv: value.iv, ciphertext: value.ciphertext });
}
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    assert(size <= MAX_BODY, 413, 'Request is too large.');
    chunks.push(chunk);
  }
  assert(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'Use JSON for this request.');
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString()); assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 400, 'Invalid request.'); return parsed; }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid JSON.'); }
}

export function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000';
  const publicURL = new URL(origin);
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === 'true';
  assert(publicURL.origin === origin, 500, 'APP_ORIGIN must be an origin without a trailing slash or path.');
  assert(!production || publicURL.protocol === 'https:', 500, 'Production requires an HTTPS APP_ORIGIN.');
  assert(production || ['127.0.0.1', 'localhost', '[::1]'].includes(publicURL.hostname), 500, 'Development requires a loopback APP_ORIGIN.');
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? resolve(ROOT, 'data'));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, 'ember.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, kdf_salt TEXT NOT NULL,
      auth_salt TEXT NOT NULL, auth_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vaults (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);`);
  db.prepare('INSERT OR IGNORE INTO meta VALUES (?, ?)').run('challenge-secret', randomBytes(32).toString('hex'));
  const challengeSecret = db.prepare('SELECT value FROM meta WHERE key=?').get('challenge-secret').value;
  const rate = new Map();
  let hashing = 0;
  async function credentialHash(credential, salt) {
    assert(hashing < 2, 503, 'Please wait a moment and try again.');
    hashing++;
    try { return await derive(credential, salt, 64, SCRYPT); }
    finally { hashing--; }
  }
  function limit(key, max, windowMs) {
    const now = Date.now();
    if (rate.size > 10000) for (const [id, item] of rate) if (item.until < now) rate.delete(id);
    assert(rate.size < 12000 || rate.has(key), 503, 'Please try again later.');
    let bucket = rate.get(key);
    if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + windowMs }; rate.set(key, bucket); }
    assert(++bucket.count <= max, 429, 'Too many attempts. Please wait before trying again.');
  }
  const cookieName = production ? '__Host-ember_session' : 'ember_session';
  function cookie(res, token, age) {
    res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`);
  }
  function session(req, csrf = false) {
    const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    assert(raw && /^[A-Za-z0-9_-]{43}$/.test(raw), 401, 'Sign in to open your diary.');
    const found = db.prepare('SELECT sessions.*, users.email, users.kdf_salt FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(hash(raw), Date.now());
    assert(found, 401, 'Your session has ended. Sign in again.');
    if (csrf) assert(typeof req.headers['x-csrf-token'] === 'string' && req.headers['x-csrf-token'] === found.csrf, 403, 'Please refresh your session before saving.');
    return found;
  }
  function newSession(res, user) {
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    // Bound active sessions per account; every sign-in receives a fresh random token.
    const sessions = db.prepare('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC').all(user.id);
    for (const old of sessions.slice(4)) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(old.token_hash);
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(hash(token), user.id, csrf, Date.now() + SESSION_MS);
    cookie(res, token, SESSION_MS / 1000);
    return { user: { id: user.id, email: user.email, salt: user.kdf_salt }, csrf };
  }
  function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  const assets = new Map([
    ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
    ...['app.js', 'crypto.js', 'domain.js', 'questions.js'].map(name => ['/' + name, [name, 'text/javascript']]),
    ['/styles.css', ['styles.css', 'text/css']]
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      assert(req.headers.host === publicURL.host, 403, 'Invalid request host.');
      const url = new URL(req.url, origin), method = req.method;
      if (!url.pathname.startsWith('/api/')) {
        assert(method === 'GET' || method === 'HEAD', 405, 'Method not allowed.');
        const asset = assets.get(url.pathname);
        assert(asset, 404, 'Page not found.');
        const content = readFileSync(resolve(ROOT, asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });
        res.end(method === 'HEAD' ? undefined : content); return;
      }
      const forwarded = trustProxy ? req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() : '';
      const clientAddress = forwarded && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
      limit('request:' + clientAddress, 600, 60_000);
      if (!['GET', 'HEAD'].includes(method)) assert(req.headers.origin === origin && req.headers['sec-fetch-site'] !== 'cross-site', 403, 'Cross-site requests are not accepted.');
      if (url.pathname === '/api/health' && method === 'GET') { json(res, 200, { ok: true }); return; }
      if (url.pathname === '/api/auth/challenge' && method === 'POST') {
        limit('challenge:' + clientAddress, 40, 15 * 60_000);
        const input = await body(req), email = String(input.email || '').trim().toLowerCase();
        assert(EMAIL.test(email) && email.length <= 254, 400, 'Enter a valid email address.');
        const user = db.prepare('SELECT kdf_salt FROM users WHERE email=?').get(email);
        const fakeSalt = createHmac('sha256', challengeSecret).update(email).digest().subarray(0, 16).toString('base64');
        json(res, 200, { salt: user?.kdf_salt || fakeSalt, iterations: 600000 }); return;
      }
      if (['/api/auth/register', '/api/auth/login'].includes(url.pathname) && method === 'POST') {
        limit('auth:' + clientAddress, 15, 15 * 60_000);
        const input = await body(req), email = String(input.email || '').trim().toLowerCase();
        assert(EMAIL.test(email) && email.length <= 254 && validBase64(input.credential, 32), 400, 'Invalid account details.');
        limit('email:' + hash(email), 10, 15 * 60_000);
        if (url.pathname.endsWith('register')) {
          assert(UUID.test(input.id) && validBase64(input.salt, 16), 400, 'Invalid account details.');
          const payload = envelope(input.vault);
          const authSalt = randomBytes(32).toString('hex'), authHash = (await credentialHash(input.credential, authSalt)).toString('hex');
          assert(!db.prepare('SELECT id FROM users WHERE email=? OR id=?').get(email, input.id), 409, 'Unable to create this account. Try signing in instead.');
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run(input.id, email, input.salt, authSalt, authHash, Date.now());
            db.prepare('INSERT INTO vaults VALUES (?, ?, 1, ?)').run(input.id, payload, Date.now());
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          const user = db.prepare('SELECT * FROM users WHERE id=?').get(input.id);
          json(res, 201, { ...newSession(res, user), revision: 1 }); return;
        }
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const computed = await credentialHash(input.credential, user?.auth_salt || challengeSecret);
        const expected = user ? Buffer.from(user.auth_hash, 'hex') : Buffer.alloc(64);
        const activeUser = user && db.prepare('SELECT auth_hash FROM users WHERE id=?').get(user.id);
        assert(timingSafeEqual(computed, expected) && activeUser?.auth_hash === user?.auth_hash && user, 401, 'Email or passphrase is incorrect.');
        json(res, 200, newSession(res, user)); return;
      }
      if (url.pathname === '/api/auth/session' && method === 'GET') {
        const current = session(req);
        json(res, 200, { user: { id: current.user_id, email: current.email, salt: current.kdf_salt }, csrf: current.csrf }); return;
      }
      if (url.pathname === '/api/auth/logout' && method === 'POST') {
        const current = session(req, true);
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(current.token_hash);
        cookie(res, '', 0); json(res, 200, { ok: true }); return;
      }
      if (url.pathname === '/api/vault' && method === 'GET') {
        const current = session(req);
        const vault = db.prepare('SELECT * FROM vaults WHERE user_id=?').get(current.user_id);
        json(res, 200, { vault: JSON.parse(vault.payload), revision: vault.revision }); return;
      }
      if (url.pathname === '/api/vault' && method === 'PUT') {
        const current = session(req, true), input = await body(req);
        assert(Number.isSafeInteger(input.revision) && input.revision >= 1, 400, 'Invalid diary revision.');
        const payload = envelope(input.vault);
        const result = db.prepare('UPDATE vaults SET payload=?, revision=revision+1, updated_at=? WHERE user_id=? AND revision=?').run(payload, Date.now(), current.user_id, input.revision);
        assert(result.changes === 1, 409, 'Another session updated this diary. Save a backup before reopening it.');
        json(res, 200, { revision: input.revision + 1 }); return;
      }
      if (url.pathname === '/api/auth/password' && method === 'POST') {
        const current = session(req, true), input = await body(req);
        limit('sensitive:' + current.user_id, 5, 15 * 60_000);
        assert(validBase64(input.credential, 32) && validBase64(input.newCredential, 32) && validBase64(input.salt, 16) && Number.isSafeInteger(input.revision), 400, 'Invalid passphrase update.');
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(current.user_id);
        const verified = await credentialHash(input.credential, user.auth_salt);
        assert(timingSafeEqual(verified, Buffer.from(user.auth_hash, 'hex')), 401, 'Current passphrase is incorrect.');
        const payload = envelope(input.vault), authSalt = randomBytes(32).toString('hex');
        const authHash = (await credentialHash(input.newCredential, authSalt)).toString('hex');
        assert(db.prepare('SELECT auth_hash FROM users WHERE id=?').get(user.id)?.auth_hash === user.auth_hash, 401, 'Your credentials changed. Sign in again.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare('UPDATE vaults SET payload=?, revision=revision+1, updated_at=? WHERE user_id=? AND revision=?').run(payload, Date.now(), user.id, input.revision);
          assert(result.changes === 1, 409, 'Another session updated this diary. Reopen it before changing your passphrase.');
          db.prepare('UPDATE users SET kdf_salt=?, auth_salt=?, auth_hash=? WHERE id=?').run(input.salt, authSalt, authHash, user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        json(res, 200, { ...newSession(res, { ...user, kdf_salt: input.salt }), revision: input.revision + 1 }); return;
      }
      if (url.pathname === '/api/auth/account' && method === 'DELETE') {
        const current = session(req, true), input = await body(req);
        limit('sensitive:' + current.user_id, 5, 15 * 60_000);
        assert(validBase64(input.credential, 32), 400, 'Confirm your passphrase.');
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(current.user_id);
        const verified = await credentialHash(input.credential, user.auth_salt);
        assert(timingSafeEqual(verified, Buffer.from(user.auth_hash, 'hex')), 401, 'Current passphrase is incorrect.');
        assert(db.prepare('SELECT auth_hash FROM users WHERE id=?').get(user.id)?.auth_hash === user.auth_hash, 401, 'Your credentials changed. Sign in again.');
        db.prepare('DELETE FROM users WHERE id=?').run(user.id);
        cookie(res, '', 0); json(res, 200, { ok: true }); return;
      }
      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      // Deliberately omit request bodies, email addresses, credentials and diary data from logs.
      if (!(error instanceof HttpError)) console.error('Ember request failed:', error.code || 'INTERNAL_ERROR');
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete this request.' });
      else res.end();
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000;
  const cleanup = setInterval(() => {
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    for (const [key, item] of rate) if (item.until < Date.now()) rate.delete(key);
  }, 60_000);
  cleanup.unref();
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return { server, db };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  const { server } = createApp();
  server.listen(port, host, () => console.log(`Ember Journal: ${process.env.APP_ORIGIN || 'http://127.0.0.1:3000'}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
