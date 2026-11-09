'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const template = require('../template');

test('PHP/MySQL checklist and account lifecycle', { skip: !process.env.GROGU_MYSQL_TEST_PORT && 'Set GROGU_MYSQL_TEST_PORT for the isolated MySQL integration test.' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grogu-php-test-'));
  const publicDir = path.join(dir, 'public');
  const privateDir = path.join(dir, 'grogu-private');
  fs.mkdirSync(publicDir);
  fs.mkdirSync(privateDir);
  for (const file of ['index.html', 'app.js', 'styles.css']) fs.copyFileSync(path.join(__dirname, '..', 'public', file), path.join(publicDir, file));
  fs.copyFileSync(path.join(__dirname, '..', 'php', 'public', 'api.php'), path.join(publicDir, 'api.php'));
  fs.copyFileSync(path.join(__dirname, '..', 'php', 'grogu-private', 'api.php'), path.join(privateDir, 'api.php'));
  fs.copyFileSync(path.join(__dirname, '..', 'template.json'), path.join(privateDir, 'template.json'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const key = crypto.randomBytes(32).toString('hex');
  const configPath = path.join(privateDir, 'config.php');
  const config = `<?php return ['db_host'=>'127.0.0.1','db_port'=>${Number(process.env.GROGU_MYSQL_TEST_PORT)},'db_name'=>'grogu_test','db_user'=>'root','db_password'=>'','base_url'=>'${base}','setup_key'=>'${key}','allow_insecure_local'=>`;
  fs.writeFileSync(configPath, config + 'true];');
  const router = path.join(dir, 'router.php');
  fs.writeFileSync(router, `<?php if (str_starts_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/api/')) { require '${path.join(publicDir, 'api.php').replaceAll('\\', '/')}'; return true; } return false;`);
  const args = [];
  if (process.env.GROGU_PHP_EXTENSION_DIR) args.push('-d', `extension_dir=${process.env.GROGU_PHP_EXTENSION_DIR}`, '-d', 'extension=pdo_mysql');
  args.push('-S', `127.0.0.1:${port}`, '-t', publicDir, router);
  const child = spawn('php', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`PHP exited: ${output}`);
    try { await fetch(base); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    if (i === 99) throw new Error(`PHP did not start: ${output}`);
  }
  async function request(url, method = 'GET', body, cookie, origin = base) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Invalid JSON (${response.status}): ${text}\n${output}`); }
    if (response.status === 500) throw new Error(`Server error: ${text}\n${output}`);
    return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  fs.writeFileSync(configPath, config + 'false];');
  assert.equal((await request('/api/session')).status, 403);
  fs.writeFileSync(configPath, config + 'true];');
  const session = await request('/api/session');
  assert.equal(session.data.needsSetup, true, 'Test database must be freshly initialized.');
  assert.equal(session.data.setupKeyRequired, true);
  assert.equal((await request('/api/projects')).status, 401);
  assert.equal((await request('/api/setup', 'POST', {}, null, 'https://other.example')).status, 403);
  assert.equal((await request('/api/setup', 'POST', { setupKey: 'wrong' })).status, 403);
  const setup = await request('/api/setup', 'POST', { name: 'Admin', email: 'admin@example.com', password: 'secure-password', setupKey: key });
  assert.equal(setup.status, 200);
  const admin = setup.cookie;
  assert.equal((await request('/api/setup', 'POST', { setupKey: key })).status, 403);
  const memberPassword = 'long-password-'.repeat(7) + 'a';
  const member = await request('/api/users', 'POST', { name: 'Designer', email: 'designer@example.com', password: memberPassword, role: 'member' }, admin);
  assert.equal(member.status, 201);
  assert.equal((await request('/api/users', 'POST', { name: 'Designer', email: 'designer@example.com', password: 'another-password', role: 'member' }, admin)).status, 409);
  assert.equal((await request('/api/login', 'POST', { email: 'designer@example.com', password: memberPassword.slice(0, -1) + 'b' })).status, 401);
  const signedIn = await request('/api/login', 'POST', { email: 'designer@example.com', password: memberPassword });
  assert.equal(signedIn.status, 200);
  const memberCookie = signedIn.cookie;
  assert.equal((await request('/api/users', 'POST', { name: 'No', email: 'no@example.com', password: 'another-password', role: 'admin' }, memberCookie)).status, 403);
  const created = await request('/api/projects', 'POST', { name: 'Example site', designer_id: member.data.user.id, launch_date: '2026-12-01' }, memberCookie);
  assert.equal(created.status, 201);
  const id = created.data.project.id;
  const detail = await request(`/api/projects/${id}`, 'GET', undefined, admin);
  assert.equal(detail.data.items.length, template.flatMap(([, items]) => items).length);
  assert.equal(detail.data.project.designer_id, member.data.user.id);
  const item = detail.data.items[0].id;
  for (const role of ['designer', 'developer', 'content_admin', 'tester', 'account_exec']) {
    assert.equal((await request(`/api/projects/${id}/items/${item}`, 'PATCH', { [role]: true }, memberCookie)).status, 200);
  }
  const item2 = detail.data.items[1].id;
  assert.equal((await request(`/api/projects/${id}/items/${item2}`, 'PATCH', { not_applicable: true }, admin)).status, 200);
  assert.equal((await request(`/api/projects/${id}/items/${item2}`, 'PATCH', { notes: 'Not needed' }, admin)).status, 200);
  assert.equal((await request(`/api/projects/${id}/items/${item2}`, 'PATCH', { designer: 'yes' }, admin)).status, 400);
  assert.equal((await request('/api/projects', 'GET', undefined, admin)).data.projects[0].completed, 2);
  assert.equal((await request(`/api/projects/${id}`, 'PATCH', { ...detail.data.project, name: 'Updated site' }, admin)).data.project.name, 'Updated site');
  assert.equal((await request('/api/password', 'POST', { currentPassword: 'wrong', newPassword: 'replacement-password' }, memberCookie)).status, 400);
  const changed = await request('/api/password', 'POST', { currentPassword: memberPassword, newPassword: 'replacement-password' }, memberCookie);
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/projects', 'GET', undefined, memberCookie)).status, 401);
  assert.equal((await request('/api/projects', 'GET', undefined, changed.cookie)).status, 200);
  assert.equal((await request(`/api/users/${member.data.user.id}`, 'DELETE', undefined, admin)).status, 200);
  assert.equal((await request('/api/projects', 'GET', undefined, changed.cookie)).status, 401);
  assert.equal((await request(`/api/projects/${id}`, 'GET', undefined, admin)).data.project.designer_id, null);
  assert.equal((await request(`/api/projects/${id}`, 'DELETE', undefined, admin)).status, 200);
  assert.equal((await request(`/api/projects/${id}`, 'GET', undefined, admin)).status, 404);
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/login', 'POST', { email: 'admin@example.com', password: 'incorrect-password' })).status, 401);
  assert.equal((await request('/api/login', 'POST', { email: 'admin@example.com', password: 'incorrect-password' })).status, 429);
});
