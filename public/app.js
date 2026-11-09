'use strict';

const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
const state = { user: null, users: [], projects: [], project: null, items: [], view: 'dashboard', search: '' };
const brandIcon = () => `<img class="brand-mark" src="${escapeHtml(window.groguIconUrl || '/icon.svg')}" alt="">`;
const roleColumns = [
  ['designer', 'Designer'], ['developer', 'Developer'], ['content_admin', 'Content admin'],
  ['tester', 'Extra tester'], ['account_exec', 'Account exec']
];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const percent = (completed, total) => total ? Math.round(completed / total * 100) : 0;
const completed = item => Boolean(item.not_applicable || roleColumns.every(([key]) => item[key]));
const date = value => {
  if (!value) return 'Not set';
  const parsed = new Date(value + 'T12:00:00');
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
async function api(url, options = {}) {
  if (window.groguCloud) return window.groguCloud.api(url, options);
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
let toastTimer;
function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
function showError(error) { notify(error.message || 'Something went wrong.'); }
function badge(done, total, started = done) {
  const text = done === total && total ? 'Ready to launch' : started ? 'In progress' : 'Not started';
  const style = done === total && total ? 'done' : started ? '' : 'new';
  return `<span class="badge ${style}">${text}</span>`;
}
function progress(done, total) {
  const p = percent(done, total);
  return `<div class="progress-line"><progress class="track" aria-label="Checklist progress" value="${p}" max="100"></progress><span class="percent">${p}%</span></div>`;
}
function shell(content, title) {
  app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand">${brandIcon()}<span class="brand-name">Grogu<span class="brand-dot">.</span></span></div>
      <p class="side-label">WORKSPACE</p>
      <button class="nav-button ${state.view !== 'team' ? 'active' : ''}" data-action="dashboard"><span class="nav-icon">▦</span><span class="nav-text">Dashboard</span></button>
      <button class="nav-button ${state.view === 'team' ? 'active' : ''}" data-action="team"><span class="nav-icon">♧</span><span class="nav-text">Team members</span></button>
      <div class="side-bottom"><div class="side-user"><span class="avatar">${escapeHtml(initials(state.user.name))}</span><div class="side-user-text"><strong>${escapeHtml(state.user.name)}</strong><small>${escapeHtml(state.user.role === 'admin' ? 'Administrator' : 'Team member')}</small></div></div><button class="signout" data-action="password">Change password</button> <button class="signout" data-action="logout">Sign out ↗</button></div>
    </aside>
    <main class="main"><header class="topbar"><div class="breadcrumbs">Workspace &nbsp; / &nbsp; <strong>${escapeHtml(title)}</strong></div><div class="top-right"><button class="link-button" data-action="password">Password</button><button class="link-button" data-action="logout">Sign out</button><span class="avatar">${escapeHtml(initials(state.user.name))}</span></div></header><div class="content">${content}</div></main>
  </div>`;
}
function auth(setup) {
  app.innerHTML = `<main class="auth"><div class="auth-card">
    <div class="brand">${brandIcon()}<span>Grogu.</span></div>
    <div class="eyebrow">${setup ? 'GET STARTED' : 'WELCOME BACK'}</div>
    <h1>${setup ? 'Set up your workspace' : 'Sign in to your workspace'}</h1>
    <p class="subtitle">${setup ? 'Create the first administrator account to get your team ready for launch.' : 'Your website launches, all in one place.'}</p>
    <form id="auth-form"><p class="form-error" role="alert"></p>
      ${setup ? '<label class="field"><span>Your name</span><input name="name" required maxlength="100" autocomplete="name" placeholder="e.g. Alex Morgan"></label>' : ''}
      ${setup && state.setupKeyRequired ? '<label class="field"><span>Setup key</span><input name="setupKey" type="password" required autocomplete="off" placeholder="Enter your private setup key"></label>' : ''}
      <label class="field"><span>Email address</span><input name="email" type="email" required maxlength="254" autocomplete="username" placeholder="you@company.com"></label>
      <label class="field"><span>Password</span><input name="password" type="password" required minlength="10" maxlength="200" autocomplete="${setup ? 'new-password' : 'current-password'}" placeholder="${setup ? 'At least 10 characters' : 'Enter your password'}"></label>
      <button class="button primary" type="submit">${setup ? 'Create workspace' : 'Sign in'} <span>→</span></button>
    </form><p class="auth-hint">${setup ? 'The first account is an administrator. You can add your team after setup.' : 'Need access? Ask your workspace administrator to create an account for you.'}</p>
  </div></main>`;
  app.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const result = await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      state.user = result.user;
      await dashboard();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
function invitation() {
  app.innerHTML = `<main class="auth"><div class="auth-card"><div class="brand">${brandIcon()}<span>Grogu.</span></div><div class="eyebrow">WELCOME TO GROGU</div><h1>Set your password</h1><p class="subtitle">Choose a password to finish accepting your invitation.</p><form><p class="form-error" role="alert"></p><label class="field"><span>New password</span><input name="password" type="password" minlength="10" maxlength="200" required autocomplete="new-password"></label><button class="button primary" type="submit">Continue</button></form></div></main>`;
  app.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      state.user = await window.groguCloud.acceptInvitation(new FormData(form).get('password'));
      await dashboard();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
async function loadCommon() {
  const [projects, users] = await Promise.all([api('/api/projects'), api('/api/users')]);
  state.projects = projects.projects;
  state.users = users.users;
}
async function dashboard() {
  await loadCommon();
  state.view = 'dashboard';
  state.project = null;
  renderDashboard();
}
function renderDashboard() {
  const projects = state.projects.filter(p => `${p.name} ${p.domain}`.toLowerCase().includes(state.search.toLowerCase()));
  const done = state.projects.filter(p => p.total && p.completed === p.total).length;
  const active = state.projects.filter(p => p.started > 0 && p.completed < p.total).length;
  shell(`<div class="heading-row"><div><div class="eyebrow">YOUR WORKSPACE</div><h1>Launch dashboard</h1><p class="subtitle">A little more clarity for every launch.</p></div><button class="button primary" data-action="new-project"><span class="plus">+</span> New go-live</button></div>
    <section class="welcome"><div class="welcome-copy"><h2>Good work starts with a great checklist.</h2><p>Keep every detail, every check, and everyone on the same page. Your next smooth launch starts here.</p></div><div class="welcome-art" aria-hidden="true">✦</div></section>
    <section class="stats" aria-label="Project overview">
      <div class="stat"><div class="stat-top">Total projects <span class="stat-icon">▣</span></div><div class="stat-value">${state.projects.length.toString().padStart(2, '0')}</div><div class="stat-foot">All go-live checklists</div></div>
      <div class="stat"><div class="stat-top">In progress <span class="stat-icon">◷</span></div><div class="stat-value">${active.toString().padStart(2, '0')}</div><div class="stat-foot">Launches in the works</div></div>
      <div class="stat"><div class="stat-top">Ready to launch <span class="stat-icon">✓</span></div><div class="stat-value">${done.toString().padStart(2, '0')}</div><div class="stat-foot">All checks completed</div></div>
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Go-live projects</h2><p>All your website launches in one place</p></div><input class="search" type="search" placeholder="Search projects..." aria-label="Search projects" value="${escapeHtml(state.search)}"></div>
      ${projects.length ? `<div class="table-wrap"><table><thead><tr><th>Project</th><th>Launch date</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody>${projects.map(p => `<tr><td><button class="link-button project-name" data-action="open-project" data-id="${p.id}"><span class="project-icon">${escapeHtml(initials(p.name).slice(0, 1))}</span><span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.domain || 'No domain added')}</small></span></button></td><td>${escapeHtml(date(p.launch_date))}</td><td>${progress(p.completed, p.total)}</td><td>${badge(p.completed, p.total, p.started)}</td><td><button class="link-button table-action" data-action="open-project" data-id="${p.id}" aria-label="Open ${escapeHtml(p.name)}">→</button></td></tr>`).join('')}</tbody></table></div><div class="footnote">Showing ${projects.length} of ${state.projects.length} projects</div>` : `<div class="empty"><strong>${state.search ? 'No matching projects' : 'Your first launch starts here'}</strong><p>${state.search ? 'Try another search term.' : 'Create a go-live checklist to get your team started.'}</p>${state.search ? '' : '<button class="button primary" data-action="new-project">+ &nbsp; Create a go-live</button>'}</div>`}
    </section>`, 'Dashboard');
  const search = app.querySelector('.search');
  search.addEventListener('input', event => {
    const position = event.target.selectionStart;
    state.search = event.target.value;
    renderDashboard();
    const next = app.querySelector('.search');
    next.focus();
    next.setSelectionRange(position, position);
  });
}
async function openProject(id) {
  const result = await api(`/api/projects/${id}`);
  state.project = result.project;
  state.items = result.items;
  state.view = 'project';
  renderProject();
}
function renderProject() {
  const p = state.project;
  const done = state.items.filter(completed).length;
  const started = state.items.some(item => item.not_applicable || roleColumns.some(([key]) => item[key]));
  const sections = [...new Set(state.items.map(item => item.section))];
  const member = id => state.users.find(user => user.id === id)?.name || 'Not assigned';
  shell(`<button class="back" data-action="dashboard">← &nbsp; Back to dashboard</button>
    <div class="heading-row"><div><div class="eyebrow">GO-LIVE CHECKLIST</div><h1>${escapeHtml(p.name)}</h1><p class="subtitle">${escapeHtml(p.domain || 'No domain added')} &nbsp; · &nbsp; ${badge(done, state.items.length, started)}</p></div><div><button class="button" data-action="edit-project">Edit details</button> <button class="button danger" data-action="delete-project">Delete</button></div></div>
    <div class="panel detail-summary"><div><span class="meta-label">Launch date</span><span class="meta-value">${escapeHtml(date(p.launch_date))}</span></div><div><span class="meta-label">Hosting</span><span class="meta-value">${escapeHtml(p.host || 'Not set')}</span></div><div><span class="meta-label">Stage site</span><span class="meta-value">${escapeHtml(p.stage_url || 'Not set')}</span></div><div><span class="meta-label">Designer</span><span class="meta-value">${escapeHtml(member(p.designer_id))}</span></div><div><span class="meta-label">Developer</span><span class="meta-value">${escapeHtml(member(p.developer_id))}</span></div><div><span class="meta-label">Extra tester</span><span class="meta-value">${escapeHtml(member(p.tester_id))}</span></div><div><span class="meta-label">Account executive</span><span class="meta-value">${escapeHtml(member(p.account_id))}</span></div><div><span class="meta-label">Project notes</span><span class="meta-value">${escapeHtml(p.notes || 'No notes')}</span></div></div>
    <div class="panel detail-progress"><strong>Launch readiness</strong>${progress(done, state.items.length)}<small>${done} of ${state.items.length} checks complete</small></div>
    <section class="panel"><div class="panel-heading"><div><h2>Checklist</h2><p>Work through each section with your team</p></div><span class="help-text">A check is complete when all five roles sign off, or it is marked N/A.</span></div>
      ${sections.map(section => `<div class="section-title">${escapeHtml(section)}</div><div class="table-wrap"><table class="check-table"><thead><tr><th>Check</th>${roleColumns.map(([, label]) => `<th>${label}</th>`).join('')}<th>N/A</th><th>Notes</th></tr></thead><tbody>${state.items.filter(item => item.section === section).map(item => `<tr class="${item.not_applicable ? 'item-na' : ''}"><td>${escapeHtml(item.title)}</td>${roleColumns.map(([key, label]) => `<td><input type="checkbox" data-item="${item.id}" data-field="${key}" aria-label="${label}: ${escapeHtml(item.title)}" ${item[key] ? 'checked' : ''} ${item.not_applicable ? 'disabled' : ''}></td>`).join('')}<td><input type="checkbox" data-item="${item.id}" data-field="not_applicable" aria-label="Not applicable: ${escapeHtml(item.title)}" ${item.not_applicable ? 'checked' : ''}></td><td><input class="note-input" data-item="${item.id}" data-field="notes" aria-label="Notes: ${escapeHtml(item.title)}" placeholder="Add a note..." value="${escapeHtml(item.notes)}" maxlength="5000"></td></tr>`).join('')}</tbody></table></div>`).join('')}
    </section>`, p.name);
  app.querySelectorAll('[data-item]').forEach(input => input.addEventListener('change', async event => {
    const element = event.currentTarget;
    const id = Number(element.dataset.item);
    const field = element.dataset.field;
    const value = element.type === 'checkbox' ? element.checked : element.value;
    element.disabled = true;
    try {
      const result = await api(`/api/projects/${p.id}/items/${id}`, { method: 'PATCH', body: { [field]: value } });
      const index = state.items.findIndex(item => item.id === id);
      state.items[index] = result.item;
      renderProject();
    } catch (error) {
      showError(error);
      renderProject();
    }
  }));
}
async function team() {
  await loadCommon();
  state.view = 'team';
  shell(`<div class="heading-row"><div><div class="eyebrow">YOUR WORKSPACE</div><h1>Team members</h1><p class="subtitle">The people behind your successful launches.</p></div>${state.user.role === 'admin' ? '<button class="button primary" data-action="new-user"><span class="plus">+</span> Add member</button>' : ''}</div>
    <section class="panel"><div class="panel-heading"><div><h2>Your team</h2><p>${state.users.length} ${state.users.length === 1 ? 'member' : 'members'} in this workspace</p></div></div><div class="table-wrap"><table class="team-list"><thead><tr><th>Member</th><th>Access</th><th></th></tr></thead><tbody>${state.users.map(user => `<tr><td><div class="team-person"><span class="avatar">${escapeHtml(initials(user.name))}</span><span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></span></div></td><td><span class="role-tag ${user.role}">${user.role === 'admin' ? 'Admin' : 'Member'}</span></td><td>${state.user.role === 'admin' && user.id !== state.user.id ? `<button class="button small danger" data-action="delete-user" data-id="${user.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div><div class="footnote">Admins manage team accounts. All members can manage projects and checklist sign-offs.</div></section>`, 'Team members');
}
function openDialog(title, subtitle, body, submitLabel, onSubmit) {
  dialog.innerHTML = `<form><div class="modal-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="close" type="button" aria-label="Close">×</button></div><div class="modal-body"><p class="form-error" role="alert"></p>${body}</div><div class="modal-actions"><button class="button cancel" type="button">Cancel</button><button class="button primary" type="submit">${escapeHtml(submitLabel)}</button></div></form>`;
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.querySelector('.cancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
      dialog.close();
    } catch (error) { form.querySelector('.form-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  dialog.showModal();
}
function projectForm(p = {}) {
  const input = (label, name, placeholder = '', type = 'text', required = false) => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(p[name] || '')}" placeholder="${placeholder}" maxlength="500" ${required ? 'required' : ''}></label>`;
  const select = (label, name) => `<label class="field"><span>${label}</span><select name="${name}"><option value="">Not assigned</option>${state.users.map(user => `<option value="${user.id}" ${p[name] === user.id ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('')}</select></label>`;
  openDialog(p.id ? 'Edit project details' : 'Create a go-live', p.id ? 'Keep your launch details up to date.' : 'Start with your standard website go-live template.',
    `<div class="form-grid">${input('Project name *', 'name', 'e.g. Acme website', 'text', true)}${input('Launch date', 'launch_date', '', 'date')}${input('Domain', 'domain', 'e.g. acme.com')}${input('Stage site', 'stage_url', 'e.g. https://staging.acme.com')}${input('Hosting / who hosts', 'host', 'e.g. Hosting provider')}${select('Primary designer', 'designer_id')}${select('Primary developer', 'developer_id')}${select('Extra tester', 'tester_id')}${select('Account executive', 'account_id')}<label class="field full"><span>Project notes</span><textarea name="notes" maxlength="5000" placeholder="Anything your team should know...">${escapeHtml(p.notes || '')}</textarea></label></div>`, p.id ? 'Save changes' : 'Create checklist', async values => {
      if (p.id) {
        await api(`/api/projects/${p.id}`, { method: 'PATCH', body: values });
        await openProject(p.id);
        notify('Project details saved.');
      } else {
        const result = await api('/api/projects', { method: 'POST', body: values });
        await openProject(result.project.id);
        notify('Your checklist is ready.');
      }
    });
}
function userForm() {
  if (window.groguCloud) {
    openDialog('Invite a team member', 'They will receive an email to set their own password.',
      `<div class="form-grid"><label class="field full"><span>Full name *</span><input name="name" required maxlength="100" autocomplete="name"></label><label class="field full"><span>Email address *</span><input name="email" type="email" required maxlength="254" autocomplete="email"></label><label class="field full"><span>Access</span><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label></div>`,
      'Send invitation', async values => { await api('/api/users', { method: 'POST', body: values }); await team(); notify('Invitation sent.'); });
    return;
  }
  openDialog('Add a team member', 'Create an account for someone on your team.',
    `<div class="form-grid"><label class="field full"><span>Full name *</span><input name="name" required maxlength="100" autocomplete="name" placeholder="e.g. Alex Morgan"></label><label class="field full"><span>Email address *</span><input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="alex@company.com"></label><label class="field full"><span>Temporary password *</span><input name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password" placeholder="At least 10 characters"></label><label class="field full"><span>Access</span><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label><p class="help-text field full">Share the credentials securely. Admins can add and remove members; all members can manage checklists.</p></div>`,
    'Add member', async values => {
      await api('/api/users', { method: 'POST', body: values });
      await team();
      notify('Team member added.');
    });
}
function passwordForm() {
  openDialog('Change password', 'Choose a new password for your account.',
    `<div class="form-grid"><label class="field full"><span>Current password</span><input name="currentPassword" type="password" required maxlength="200" autocomplete="current-password"></label><label class="field full"><span>New password</span><input name="newPassword" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></label></div>`,
    'Update password', async values => {
      await api('/api/password', { method: 'POST', body: values });
      notify('Password updated. Your other sessions have been signed out.');
    });
}
app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  try {
    switch (button.dataset.action) {
      case 'dashboard': await dashboard(); break;
      case 'team': await team(); break;
      case 'logout': await api('/api/logout', { method: 'POST' }); state.user = null; auth(false); break;
      case 'new-project': projectForm(); break;
      case 'open-project': await openProject(button.dataset.id); break;
      case 'edit-project': projectForm(state.project); break;
      case 'new-user': userForm(); break;
      case 'password': passwordForm(); break;
      case 'delete-project':
        if (confirm(`Delete "${state.project.name}" and its entire checklist? This cannot be undone.`)) {
          await api(`/api/projects/${state.project.id}`, { method: 'DELETE' });
          await dashboard();
          notify('Project deleted.');
        }
        break;
      case 'delete-user': {
        const user = state.users.find(member => String(member.id) === button.dataset.id);
        if (user && confirm(`Remove ${user.name}? Their account and project assignments will be removed.`)) {
          await api(`/api/users/${user.id}`, { method: 'DELETE' });
          await team();
          notify('Team member removed.');
        }
        break;
      }
    }
  } catch (error) { showError(error); }
});
async function init() {
  try {
    const result = await api('/api/session');
    state.setupKeyRequired = result.setupKeyRequired;
    if (result.invitation) return invitation();
    if (!result.user) return auth(result.needsSetup);
    state.user = result.user;
    await dashboard();
  } catch (error) {
    app.innerHTML = `<main class="auth"><div class="auth-card"><h1>Unable to connect</h1><p class="subtitle">${escapeHtml(error.message)}</p><button class="button primary" id="retry">Try again</button></div></main>`;
    app.querySelector('#retry').addEventListener('click', init);
  }
}
init();
