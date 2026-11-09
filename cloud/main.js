import { createClient } from '@supabase/supabase-js';
import template from '../template.json';
import '../public/styles.css';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const inviteFlow = new URLSearchParams(location.hash.slice(1)).get('type') === 'invite';
if (!url || !key) {
  document.querySelector('#app').textContent = 'Grogu is not configured. Set the Supabase project URL and publishable key.';
  throw new Error('Missing Supabase public configuration.');
}
const supabase = createClient(url, key);
const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};
const fields = ['name', 'domain', 'stage_url', 'host', 'launch_date', 'notes', 'designer_id', 'developer_id', 'tester_id', 'account_id'];
const roleFields = ['designer', 'developer', 'content_admin', 'tester', 'account_exec'];
const projectValues = body => Object.fromEntries(fields.map(field => [field, field.endsWith('_id') ? (body[field] || null) : (body[field] || '').trim()]));
const getUser = async () => {
  const { session } = unwrap(await supabase.auth.getSession());
  if (!session) return null;
  const profile = unwrap(await supabase.from('grogu_members').select('*').eq('id', session.user.id).maybeSingle());
  if (!profile) {
    await supabase.auth.signOut();
    throw new Error('This account does not have access to Grogu. Contact your administrator.');
  }
  return profile;
};
async function teamAction(body) {
  const { data, error } = await supabase.functions.invoke('team', { body });
  if (error) {
    let message = error.message;
    if (error.context instanceof Response) {
      try { message = (await error.context.json()).error || message; } catch { /* Response may not be JSON. */ }
    }
    throw new Error(message);
  }
  return data;
}
async function api(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body || {};
  if (path === '/api/session') return { user: await getUser(), needsSetup: false, invitation: inviteFlow };
  if (path === '/api/login' && method === 'POST') {
    unwrap(await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password }));
    return { user: await getUser() };
  }
  if (path === '/api/logout') {
    unwrap(await supabase.auth.signOut());
    return { ok: true };
  }
  if (path === '/api/password') {
    const user = await getUser();
    unwrap(await supabase.auth.signInWithPassword({ email: user.email, password: body.currentPassword }));
    unwrap(await supabase.auth.updateUser({ password: body.newPassword }));
    unwrap(await supabase.auth.signOut({ scope: 'others' }));
    return { ok: true };
  }
  if (path === '/api/users' && method === 'GET') return { users: unwrap(await supabase.from('grogu_members').select('*').order('name')) };
  if (path === '/api/users' && method === 'POST') return teamAction({ action: 'invite', ...body });
  const user = path.match(/^\/api\/users\/([^/]+)$/);
  if (user && method === 'DELETE') return teamAction({ action: 'remove', id: user[1] });
  if (path === '/api/projects' && method === 'GET') {
    const projects = unwrap(await supabase.from('grogu_projects').select('*, grogu_items(designer,developer,content_admin,tester,account_exec,not_applicable)').order('updated_at', { ascending: false }));
    return { projects: projects.map(({ grogu_items: items, ...p }) => ({ ...p, total: items.length, completed: items.filter(item => item.not_applicable || roleFields.every(field => item[field])).length, started: items.filter(item => item.not_applicable || roleFields.some(field => item[field])).length })) };
  }
  if (path === '/api/projects' && method === 'POST') {
    const checks = template.flatMap(([section, titles]) => titles.map(title => ({ section, title })));
    const id = unwrap(await supabase.rpc('grogu_create_project', { details: projectValues(body), checks }));
    return { project: { id } };
  }
  const item = path.match(/^\/api\/projects\/(\d+)\/items\/(\d+)$/);
  if (item && method === 'PATCH') {
    const result = unwrap(await supabase.from('grogu_items').update(body).eq('project_id', item[1]).eq('id', item[2]).select().single());
    return { item: result };
  }
  const project = path.match(/^\/api\/projects\/(\d+)$/);
  if (project) {
    if (method === 'GET') {
      const p = unwrap(await supabase.from('grogu_projects').select('*').eq('id', project[1]).single());
      const items = unwrap(await supabase.from('grogu_items').select('*').eq('project_id', project[1]).order('position'));
      return { project: p, items };
    }
    if (method === 'PATCH') return { project: unwrap(await supabase.from('grogu_projects').update(projectValues(body)).eq('id', project[1]).select().single()) };
    if (method === 'DELETE') {
      unwrap(await supabase.from('grogu_projects').delete().eq('id', project[1]).select().single());
      return { ok: true };
    }
  }
  throw new Error('Unsupported request.');
}
window.groguCloud = {
  api,
  async acceptInvitation(password) {
    const { session } = unwrap(await supabase.auth.getSession());
    if (!session) throw new Error('Your invitation has expired or is invalid. Ask an administrator for a new one.');
    unwrap(await supabase.auth.updateUser({ password }));
    history.replaceState(null, '', location.pathname);
    return getUser();
  }
};
import('../public/app.js').catch(error => {
  console.error(error);
  document.querySelector('#app').textContent = 'Could not load Grogu. Please refresh and try again.';
});
