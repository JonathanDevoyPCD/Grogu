import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const siteUrl = Deno.env.get('GROGU_SITE_URL')!
const allowedOrigin = new URL(siteUrl).origin

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  }
  const respond = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers })
  if (origin !== allowedOrigin) return respond(403, { error: 'Invalid origin.' })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return respond(405, { error: 'Method not allowed.' })
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return respond(401, { error: 'Please sign in.' })
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  try {
    const { data: identity, error: identityError } = await caller.auth.getUser()
    if (identityError || !identity.user) return respond(401, { error: 'Please sign in.' })
    const { data: member, error: memberError } = await admin.from('grogu_members').select('role').eq('id', identity.user.id).maybeSingle()
    if (memberError) throw memberError
    if (member?.role !== 'admin') return respond(403, { error: 'Only admins can manage members.' })
    const input = await req.json()
    if (input.action === 'invite') {
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
      if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !['admin', 'member'].includes(input.role)) return respond(400, { error: 'Enter a valid name, email and role.' })
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: siteUrl })
      if (error || !data.user) return respond(400, { error: error?.message ?? 'Could not send invitation.' })
      const { error: insertError } = await admin.from('grogu_members').insert({ id: data.user.id, name, email, role: input.role })
      if (insertError) {
        // An existing Auth user may have been returned; never delete it on failure.
        throw insertError
      }
      return respond(200, { ok: true })
    }
    if (input.action === 'remove') {
      if (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id) || input.id === identity.user.id) return respond(400, { error: 'Choose another team member.' })
      const { data: target, error: targetError } = await admin.from('grogu_members').select('id').eq('id', input.id).maybeSingle()
      if (targetError) throw targetError
      if (!target) return respond(404, { error: 'Team member not found.' })
      const { error } = await admin.auth.admin.deleteUser(input.id)
      if (error) throw error
      return respond(200, { ok: true })
    }
    return respond(400, { error: 'Unknown action.' })
  } catch (error) {
    console.error('Team function error:', error)
    return respond(500, { error: 'Could not manage team member. Check server logs.' })
  }
})
