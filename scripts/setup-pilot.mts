// setup-pilot.mts — Onboard a new pilot customer into CoreOps.
//
// Usage:
//   node --import tsx/esm scripts/setup-pilot.mts \
//     --email owner@example.com \
//     --business-name "Ramesh Traders" \
//     --env-file pilots/ramesh.env \
//     --consent-confirmed
//
// The --env-file flag points to a per-pilot env file (e.g. pilots/ramesh.env)
// that carries the pilot's Zoho / WhatsApp credentials.  If omitted the script
// reads from process.env (useful when running in CI with secrets injected).
//
// DPDP REQUIREMENT: --consent-confirmed must be passed explicitly.  The script
// refuses to insert any credentials without it.  Connecting to a customer's
// data without a consent record must be impossible by construction.
//
// What this script does:
//   1. Validates flags — refuses without --consent-confirmed
//   2. Loads per-pilot env file (dotenv-parse) if --env-file is provided
//   3. Creates / finds Supabase auth user for the owner
//   4. Upserts business row
//   5. Writes consent_records row (DPDP)
//   6. Upserts encrypted zoho_books connected_account (if ZOHO_* vars are set)
//   7. Upserts encrypted whatsapp connected_account (if WHATSAPP_* vars are set)
//
// Idempotent: re-running with the same credentials is safe (upserts, not inserts).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  email: string
  businessName: string
  envFile: string | null
  consentConfirmed: boolean
} {
  const args = argv.slice(2)
  let email = ''
  let businessName = ''
  let envFile: string | null = null
  let consentConfirmed = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--email':
        email = args[++i] ?? ''
        break
      case '--business-name':
        businessName = args[++i] ?? ''
        break
      case '--env-file':
        envFile = args[++i] ?? null
        break
      case '--consent-confirmed':
        consentConfirmed = true
        break
    }
  }

  return { email, businessName, envFile, consentConfirmed }
}

// ── Dotenv-lite parser ────────────────────────────────────────────────────────
// Parses KEY=VALUE lines; ignores comments and blank lines.
// Does NOT call dotenv.config() — we want per-pilot isolation, not global mutation.

function parseEnvFile(filePath: string): Record<string, string> {
  const raw = readFileSync(filePath, 'utf8')
  const result: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    // Strip optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

// ── Encryption (inline — avoids importing from apps/api which has ESM paths) ──

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function encrypt(plaintext: string): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY not set')
  const keyBuf = Buffer.from(key, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { email, businessName, envFile, consentConfirmed } = parseArgs(process.argv)

  // ── 1. Validate flags ─────────────────────────────────────────────────────
  if (!email) {
    console.error('Error: --email is required')
    process.exit(1)
  }
  if (!businessName) {
    console.error('Error: --business-name is required')
    process.exit(1)
  }
  if (!consentConfirmed) {
    console.error(
      'Error: --consent-confirmed is required.\n' +
      'You must confirm that the business owner has given explicit consent\n' +
      'under India DPDP Rules 2025 before provisioning their credentials.'
    )
    process.exit(1)
  }

  // ── 2. Load per-pilot env file (if provided) ──────────────────────────────
  let env: Record<string, string> = {}
  if (envFile) {
    const absPath = resolve(process.cwd(), envFile)
    console.log(`Loading env from: ${absPath}`)
    env = parseEnvFile(absPath)
    // Merge into process.env so encrypt() can read ENCRYPTION_KEY
    Object.assign(process.env, env)
  }

  function e(key: string): string {
    return env[key] ?? process.env[key] ?? ''
  }

  // ── 3. Supabase clients ───────────────────────────────────────────────────
  const supabaseUrl = e('SUPABASE_URL') || 'http://127.0.0.1:54321'
  const serviceRoleKey = e('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = e('SUPABASE_ANON_KEY')

  if (!serviceRoleKey) { console.error('SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1) }
  if (!anonKey) { console.error('SUPABASE_ANON_KEY not set'); process.exit(1) }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 4. Create / find owner user ───────────────────────────────────────────
  const defaultPassword = `CoreOps${new Date().getFullYear()}!`
  let userId: string

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: defaultPassword,
    email_confirm: true,
  })

  if (createErr) {
    if (!createErr.message.includes('already been registered') && !createErr.message.includes('already exists')) {
      console.error('Failed to create user:', createErr.message)
      process.exit(1)
    }
    // Already exists — resolve id
    const { data: users, error: listErr } = await admin.auth.admin.listUsers()
    if (listErr) { console.error('Failed to list users:', listErr.message); process.exit(1) }
    const existing = (users?.users ?? []).find((u) => u.email === email)
    if (!existing) { console.error(`Could not find user with email ${email}`); process.exit(1) }
    userId = existing.id
    console.log(`Found existing user: ${email} (${userId})`)
  } else {
    userId = created.user.id
    console.log(`Created user: ${email} (${userId})`)
  }

  // Get a session token for RLS-scoped writes
  const { data: sess, error: sessErr } = await anon.auth.signInWithPassword({
    email,
    password: defaultPassword,
  })
  if (sessErr) { console.error('Sign-in failed:', sessErr.message); process.exit(1) }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${sess.session!.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 5. Upsert business ────────────────────────────────────────────────────
  const { data: existingBiz } = await userClient
    .from('businesses')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle()

  let businessId: string
  if (existingBiz) {
    businessId = (existingBiz as { id: string }).id
    // Update name if it changed
    await admin.from('businesses').update({ name: businessName }).eq('id', businessId)
    console.log(`Found existing business: ${businessName} (${businessId})`)
  } else {
    const { data: newBiz, error: bizErr } = await userClient
      .from('businesses')
      .insert({ owner_user_id: userId, name: businessName })
      .select('id')
      .single()
    if (bizErr) { console.error('Failed to create business:', bizErr.message); process.exit(1) }
    businessId = (newBiz as { id: string }).id
    console.log(`Created business: ${businessName} (${businessId})`)
  }

  // ── 6. Write DPDP consent record ─────────────────────────────────────────
  // --consent-confirmed flag is the paper trail that the owner has consented.
  // Written with service_role so it bypasses RLS (no RLS insert policy for
  // service_role; the grant is explicit in migrations).
  const { error: consentErr } = await admin.from('consent_records').insert({
    business_id: businessId,
    data_principal_type: 'business_owner',
    data_principal_identifier: email,
    purpose: 'receivables_recovery_workflow',
    consent_version: 'DPDP-2025-v1',
    given_at: new Date().toISOString(),
  })
  if (consentErr) { console.error('Failed to write consent record:', consentErr.message); process.exit(1) }
  console.log('✓ Consent record written (DPDP-2025-v1)')

  // ── 7. Zoho Books connected_account ──────────────────────────────────────
  const zohoClientId = e('ZOHO_CLIENT_ID')
  const zohoClientSecret = e('ZOHO_CLIENT_SECRET')
  const zohoRefreshToken = e('ZOHO_REFRESH_TOKEN')
  const zohoOrgId = e('ZOHO_ORGANIZATION_ID')
  const zohoApiDomain = e('ZOHO_API_DOMAIN') || 'https://www.zohoapis.in'
  const zohoAuthDomain = e('ZOHO_AUTH_DOMAIN') || 'https://accounts.zoho.in'

  if (zohoClientId && zohoClientSecret && zohoRefreshToken && zohoOrgId) {
    const credentials = {
      client_id: zohoClientId,
      client_secret: zohoClientSecret,
      refresh_token: zohoRefreshToken,
      organization_id: zohoOrgId,
      access_token: '',
      access_token_expires_at: '',
      api_domain: zohoApiDomain,
      auth_domain: zohoAuthDomain,
    }
    const { error: zohoErr } = await admin.from('connected_accounts').upsert(
      {
        business_id: businessId,
        provider: 'zoho_books',
        credentials_encrypted: encrypt(JSON.stringify(credentials)),
        metadata: { organization_id: zohoOrgId },
        is_active: true,
      },
      { onConflict: 'business_id,provider' }
    )
    if (zohoErr) { console.error('Failed to upsert Zoho account:', zohoErr.message); process.exit(1) }
    console.log('✓ Zoho Books connected_account provisioned')
  } else {
    console.log('  (Zoho Books skipped — ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN / ZOHO_ORGANIZATION_ID not all set)')
  }

  // ── 8. WhatsApp connected_account ────────────────────────────────────────
  const waAccessToken = e('WHATSAPP_ACCESS_TOKEN')
  const waPhoneNumberId = e('WHATSAPP_PHONE_NUMBER_ID')
  const waWabaId = e('WHATSAPP_WABA_ID')
  const ownerPhone = e('OWNER_PHONE')

  if (waAccessToken && waPhoneNumberId && waWabaId && ownerPhone) {
    const waCredentials = {
      access_token: waAccessToken,
      phone_number_id: waPhoneNumberId,
      waba_id: waWabaId,
      owner_phone: ownerPhone,
    }
    const { error: waErr } = await admin.from('connected_accounts').upsert(
      {
        business_id: businessId,
        provider: 'whatsapp',
        credentials_encrypted: encrypt(JSON.stringify(waCredentials)),
        metadata: { phone_number_id: waPhoneNumberId, waba_id: waWabaId },
        is_active: true,
      },
      { onConflict: 'business_id,provider' }
    )
    if (waErr) { console.error('Failed to upsert WhatsApp account:', waErr.message); process.exit(1) }
    console.log('✓ WhatsApp connected_account provisioned')
  } else {
    console.log('  (WhatsApp skipped — WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_WABA_ID / OWNER_PHONE not all set)')
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────')
  console.log(`  Pilot: ${businessName}`)
  console.log(`  Owner: ${email}`)
  console.log(`  Business ID: ${businessId}`)
  console.log(`  Password: ${defaultPassword}`)
  console.log('──────────────────────────────────────────────')
  console.log('  Run npm run dev -w apps/api to start the API')
  console.log('  Run npm run test:live-sync -w apps/api to verify sync')
  console.log('──────────────────────────────────────────────\n')
}

await main()
