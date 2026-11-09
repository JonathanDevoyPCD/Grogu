'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const template = require('./template');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'launchboard.sqlite');
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '', stage_url TEXT NOT NULL DEFAULT '', host TEXT NOT NULL DEFAULT '', launch_date TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, developer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, tester_id INTEGER REFERENCES users(id) ON DELETE SET NULL, account_id INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, section TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL, notes TEXT NOT NULL DEFAULT '', designer INTEGER NOT NULL DEFAULT 0, developer INTEGER NOT NULL DEFAULT 0, content_admin INTEGER NOT NULL DEFAULT 0, tester INTEGER NOT NULL DEFAULT 0, account_exec INTEGER NOT NULL DEFAULT 0, not_applicable INTEGER NOT NULL DEFAULT 0);
`);

const run = (sql, ...args) => db.prepare(sql).run(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const roles = ['designer', 'developer', 'content_admin', 'tester', 'account_exec'];
const fields = ['name', 'domain', 'stage_url', 'host', 'launch_date', 'notes', 'designer_id', 'developer_id', 'tester_id', 'account_id'];
const userFields = 'id, name, email, role, created_at';
const loginAttempts = new Map();
const json = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(data));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}
function validateUser(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!name || name.length > 100) throw fail(400, 'Enter a name (up to 100 characters).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw fail(400, 'Enter a valid email address.');
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 200) throw fail(400, 'Password must be between 10 and 200 characters.');
  if (!['admin', 'member'].includes(body.role)) throw fail(400, 'Choose a valid role.');
  return { name, email, password: passwordHash(body.password), role: body.role };
}
function createUser(body) {
  const u = validateUser(body);
  try {
    const result = run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', u.name, u.email, u.password, u.role);
    return get(`SELECT ${userFields} FROM users WHERE id = ?`, result.lastInsertRowid);
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE constraint failed')) throw fail(409, 'That email is already in use.');
    throw error;
  }
}
function cookie(token, maxAge) {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''}`;
}
function session(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/);
  if (!match) return null;
  return get(`SELECT u.${userFields.replaceAll(', ', ', u.')} FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?`, crypto.createHash('sha256').update(match[1]).digest('hex'), Date.now());
}
function login(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  run('DELETE FROM sessions WHERE expires <= ?', Date.now());
  run('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)', crypto.createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 86400000 * 7);
  json(res, 200, { user }, { 'Set-Cookie': cookie(token, 604800) });
}
async function bodyOf(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100000) throw fail(413, 'Request is too large.');
  }
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid object');
    return value;
  } catch { throw fail(400, 'Invalid request body.'); }
}
function projectValues(body) {
  return fields.map(field => {
    if (field.endsWith('_id')) {
      if (body[field] === '' || body[field] == null) return null;
      const id = Number(body[field]);
      if (!Number.isSafeInteger(id) || id < 1 || !get('SELECT id FROM users WHERE id=?', id)) throw fail(400, 'Choose a valid team member.');
      return id;
    }
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (value.length > (field === 'notes' ? 5000 : 500)) throw fail(400, `${field} is too long.`);
    if (field === 'name' && !value) throw fail(400, 'Project name is required.');
    if (field === 'launch_date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail(400, 'Enter a valid launch date.');
    return value;
  });
}
function project(id) {
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw fail(404, 'Project not found.');
  return p;
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
async function api(req, res, url) {
  const method = req.method;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw fail(405, 'Method not allowed.');
  if (method !== 'GET') {
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host !== req.headers.host) throw fail(403, 'Invalid request origin.');
  }
  const user = session(req);
  if (url.pathname === '/api/session' && method === 'GET') return json(res, 200, { user, needsSetup: !get('SELECT id FROM users LIMIT 1') });
  if (url.pathname === '/api/setup' && method === 'POST') {
    const body = await bodyOf(req);
    const created = transaction(() => {
      if (get('SELECT id FROM users LIMIT 1')) throw fail(403, 'Setup has already been completed.');
      return createUser({ ...body, role: 'admin' });
    });
    return login(res, created);
  }
  if (url.pathname === '/api/login' && method === 'POST') {
    const address = req.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(address);
    if (attempts && attempts.until > Date.now() && attempts.count >= 10) throw fail(429, 'Too many sign-in attempts. Try again later.');
    const body = await bodyOf(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const found = get('SELECT * FROM users WHERE email=?', email);
    if (!found || password.length > 200 || !verifyPassword(password, found.password)) {
      const current = attempts && attempts.until > Date.now() ? attempts : { count: 0, until: Date.now() + 15 * 60 * 1000 };
      current.count++;
      loginAttempts.set(address, current);
      throw fail(401, 'Incorrect email or password.');
    }
    loginAttempts.delete(address);
    return login(res, get(`SELECT ${userFields} FROM users WHERE id=?`, found.id));
  }
  if (!user) throw fail(401, 'Please sign in.');
  if (url.pathname === '/api/password' && method === 'POST') {
    const body = await bodyOf(req);
    const found = get('SELECT password FROM users WHERE id=?', user.id);
    if (typeof body.currentPassword !== 'string' || body.currentPassword.length > 200 || !verifyPassword(body.currentPassword, found.password)) throw fail(400, 'Current password is incorrect.');
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 10 || body.newPassword.length > 200) throw fail(400, 'New password must be between 10 and 200 characters.');
    transaction(() => {
      run('UPDATE users SET password=? WHERE id=?', passwordHash(body.newPassword), user.id);
      run('DELETE FROM sessions WHERE user_id=?', user.id);
    });
    return login(res, user);
  }
  if (url.pathname === '/api/logout' && method === 'POST') {
    const token = (req.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/);
    if (token) run('DELETE FROM sessions WHERE token=?', crypto.createHash('sha256').update(token[1]).digest('hex'));
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  if (url.pathname === '/api/users' && method === 'GET') return json(res, 200, { users: all(`SELECT ${userFields} FROM users ORDER BY name COLLATE NOCASE`) });
  if (url.pathname === '/api/users' && method === 'POST') {
    if (user.role !== 'admin') throw fail(403, 'Only admins can add team members.');
    return json(res, 201, { user: createUser(await bodyOf(req)) });
  }
  const userMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
  if (userMatch && method === 'DELETE') {
    if (user.role !== 'admin') throw fail(403, 'Only admins can remove team members.');
    if (Number(userMatch[1]) === user.id) throw fail(400, 'You cannot remove your own account.');
    if (!run('DELETE FROM users WHERE id=?', Number(userMatch[1])).changes) throw fail(404, 'Team member not found.');
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/projects' && method === 'GET') {
    const projects = all(`SELECT p.*, COUNT(i.id) AS total, SUM(CASE WHEN i.not_applicable=1 OR (i.designer=1 AND i.developer=1 AND i.content_admin=1 AND i.tester=1 AND i.account_exec=1) THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN i.not_applicable=1 OR i.designer=1 OR i.developer=1 OR i.content_admin=1 OR i.tester=1 OR i.account_exec=1 THEN 1 ELSE 0 END) AS started FROM projects p LEFT JOIN items i ON i.project_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC`);
    return json(res, 200, { projects });
  }
  if (url.pathname === '/api/projects' && method === 'POST') {
    const values = projectValues(await bodyOf(req));
    const id = transaction(() => {
      const result = run(`INSERT INTO projects (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`, ...values);
      let position = 0;
      for (const [section, titles] of template) for (const title of titles) run('INSERT INTO items (project_id, section, title, position) VALUES (?, ?, ?, ?)', result.lastInsertRowid, section, title, position++);
      return result.lastInsertRowid;
    });
    return json(res, 201, { project: project(id) });
  }
  const projectMatch = url.pathname.match(/^\/api\/projects\/(\d+)$/);
  if (projectMatch) {
    const id = Number(projectMatch[1]);
    if (method === 'GET') return json(res, 200, { project: project(id), items: all('SELECT * FROM items WHERE project_id=? ORDER BY position', id) });
    if (method === 'PATCH') {
      project(id);
      const values = projectValues(await bodyOf(req));
      run(`UPDATE projects SET ${fields.map(field => `${field}=?`).join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`, ...values, id);
      return json(res, 200, { project: project(id) });
    }
    if (method === 'DELETE') {
      if (!run('DELETE FROM projects WHERE id=?', id).changes) throw fail(404, 'Project not found.');
      return json(res, 200, { ok: true });
    }
  }
  const itemMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/items\/(\d+)$/);
  if (itemMatch && method === 'PATCH') {
    const body = await bodyOf(req);
    const keys = Object.keys(body);
    const allowed = [...roles, 'not_applicable', 'notes'];
    if (keys.length !== 1 || !allowed.includes(keys[0])) throw fail(400, 'Update one valid checklist field at a time.');
    const key = keys[0];
    let value = body[key];
    if (key === 'notes') {
      if (typeof value !== 'string' || value.length > 5000) throw fail(400, 'Notes must be under 5,000 characters.');
    } else {
      if (typeof value !== 'boolean') throw fail(400, 'Checklist values must be true or false.');
      value = value ? 1 : 0;
    }
    const projectId = Number(itemMatch[1]);
    const itemId = Number(itemMatch[2]);
    transaction(() => {
      if (!run(`UPDATE items SET ${key}=? WHERE id=? AND project_id=?`, value, itemId, projectId).changes) throw fail(404, 'Checklist item not found.');
      run('UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', projectId);
    });
    return json(res, 200, { item: get('SELECT * FROM items WHERE id=?', itemId) });
  }
  throw fail(404, 'Not found.');
}

const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const file = staticFiles[url.pathname];
    if (req.method !== 'GET' || !file) throw fail(404, 'Not found.');
    res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'same-origin' });
    fs.createReadStream(path.join(__dirname, 'public', file[0])).pipe(res);
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong on the server.' });
    else res.destroy();
  }
});
server.listen(port, host, () => console.log(`Grogu running at http://${host}:${port}`));
