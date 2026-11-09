'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const template = require('../template');

test('shared checklist and account lifecycle', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'grogu-test-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: path.join(dir, 'test.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { await fetch(base); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    if (i === 99) throw new Error(`Server did not start: ${output}`);
  }
  const favicon = await fetch(`${base}/icon.svg`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await favicon.text(), /#70cf89/i);
  async function request(url, method = 'GET', body, cookie, origin = base) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request('/api/session')).data.needsSetup, true);
  assert.equal((await request('/api/projects')).status, 401);
  assert.equal((await request('/api/setup', 'POST', {}, null, 'https://other.example')).status, 403);
  const setup = await request('/api/setup', 'POST', { name: 'Admin', email: 'admin@example.com', password: 'secure-password' });
  assert.equal(setup.status, 200);
  const adminCookie = setup.cookie;
  assert.equal((await request('/api/setup', 'POST', { name: 'Other', email: 'other@example.com', password: 'secure-password' })).status, 403);
  const member = await request('/api/users', 'POST', { name: 'Designer', email: 'designer@example.com', password: 'another-password', role: 'member' }, adminCookie);
  assert.equal(member.status, 201);
  assert.equal((await request('/api/users', 'POST', { name: 'Designer', email: 'designer@example.com', password: 'another-password', role: 'member' }, adminCookie)).status, 409);
  const signedIn = await request('/api/login', 'POST', { email: 'designer@example.com', password: 'another-password' });
  assert.equal(signedIn.status, 200);
  const memberCookie = signedIn.cookie;
  assert.equal((await request('/api/users', 'POST', { name: 'No', email: 'no@example.com', password: 'another-password', role: 'admin' }, memberCookie)).status, 403);
  const project = await request('/api/projects', 'POST', { name: 'Example site', designer_id: member.data.user.id, launch_date: '2026-12-01' }, memberCookie);
  assert.equal(project.status, 201);
  const id = project.data.project.id;
  const detail = await request(`/api/projects/${id}`, 'GET', undefined, adminCookie);
  assert.equal(detail.data.items.length, template.flatMap(([, items]) => items).length);
  assert.equal(detail.data.project.designer_id, member.data.user.id);
  const itemId = detail.data.items[0].id;
  assert.equal((await request(`/api/projects/${id}/items/${itemId}`, 'PATCH', { designer: true }, memberCookie)).status, 200);
  const partial = (await request('/api/projects', 'GET', undefined, adminCookie)).data.projects[0];
  assert.equal(partial.completed, 0);
  assert.equal(partial.started, 1);
  for (const role of ['designer', 'developer', 'content_admin', 'tester', 'account_exec']) {
    assert.equal((await request(`/api/projects/${id}/items/${itemId}`, 'PATCH', { [role]: true }, memberCookie)).status, 200);
  }
  const secondId = detail.data.items[1].id;
  assert.equal((await request(`/api/projects/${id}/items/${secondId}`, 'PATCH', { not_applicable: true }, adminCookie)).status, 200);
  assert.equal((await request(`/api/projects/${id}/items/${secondId}`, 'PATCH', { notes: 'Not needed' }, adminCookie)).status, 200);
  assert.equal((await request(`/api/projects/${id}/items/${secondId}`, 'PATCH', { designer: 'yes' }, adminCookie)).status, 400);
  assert.equal((await request('/api/projects', 'GET', undefined, adminCookie)).data.projects[0].completed, 2);
  assert.equal((await request(`/api/projects/${id}`, 'PATCH', { ...detail.data.project, name: 'Updated site' }, adminCookie)).data.project.name, 'Updated site');
  assert.equal((await request('/api/password', 'POST', { currentPassword: 'wrong', newPassword: 'replacement-password' }, memberCookie)).status, 400);
  const changed = await request('/api/password', 'POST', { currentPassword: 'another-password', newPassword: 'replacement-password' }, memberCookie);
  assert.equal(changed.status, 200);
  assert.equal((await request('/api/projects', 'GET', undefined, memberCookie)).status, 401);
  assert.equal((await request('/api/projects', 'GET', undefined, changed.cookie)).status, 200);
  assert.equal((await request(`/api/users/${member.data.user.id}`, 'DELETE', undefined, adminCookie)).status, 200);
  assert.equal((await request('/api/projects', 'GET', undefined, changed.cookie)).status, 401);
  assert.equal((await request(`/api/projects/${id}`, 'GET', undefined, adminCookie)).data.project.designer_id, null);
  assert.equal((await request(`/api/projects/${id}`, 'DELETE', undefined, adminCookie)).status, 200);
  assert.equal((await request(`/api/projects/${id}`, 'GET', undefined, adminCookie)).status, 404);
});
