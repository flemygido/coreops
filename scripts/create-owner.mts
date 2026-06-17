import { createClient } from '@supabase/supabase-js'

const SUPA_URL = 'http://127.0.0.1:54321'
const SRK = process.env.SRK!
const ANON = process.env.ANON!

const EMAIL = 'owner@coreops.local'
const PASSWORD = 'CoreOps2026!'

const admin = createClient(SUPA_URL, SRK, { auth: { autoRefreshToken: false, persistSession: false } })
const anon  = createClient(SUPA_URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } })

// Create user — if already exists, sign in to get their id
let userId: string

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL, password: PASSWORD, email_confirm: true,
})

if (createErr) {
  if (!createErr.message.includes('already been registered')) {
    console.error('Unexpected error:', createErr.message); process.exit(1)
  }
  // Already exists — sign in to resolve the id
  const { data: si, error: siErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (siErr) { console.error('Sign in failed:', siErr.message); process.exit(1) }
  userId = si.user!.id
} else {
  userId = created.user.id
}

// Get a session for RLS-scoped writes
const { data: sess, error: sessErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (sessErr) { console.error('Session error:', sessErr.message); process.exit(1) }

const userClient = createClient(SUPA_URL, ANON, {
  global: { headers: { Authorization: `Bearer ${sess.session!.access_token}` } },
  auth: { autoRefreshToken: false, persistSession: false },
})

// Upsert business — skip if already present for this user
const { data: existing } = await userClient
  .from('businesses').select('id').eq('owner_user_id', userId).maybeSingle()

if (!existing) {
  const { error: bizErr } = await userClient
    .from('businesses')
    .insert({ owner_user_id: userId, name: 'My Business' })
  if (bizErr) { console.error('Insert business failed:', bizErr.message); process.exit(1) }
}

console.log('\n──────────────────────────────────')
console.log('  Dashboard: http://localhost:3001')
console.log('  Email    : ' + EMAIL)
console.log('  Password : ' + PASSWORD)
console.log('──────────────────────────────────\n')
