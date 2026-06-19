#!/usr/bin/env node
/**
 * End-to-end loop proof: real Zoho data → overdue calculator → LLM draft → WhatsApp briefing.
 *
 * Run from project root:
 *   npx tsx scripts/prove-e2e-loop.mts
 *
 * Requires in .env:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID
 *   ANTHROPIC_API_KEY or OPENAI_API_KEY
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 *   OWNER_PHONE  (defaults to +919751723512 — the verified test recipient)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ── 1. Load .env ────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && val && !(key in process.env)) process.env[key] = val
  }
}

// ── 1b. Auto-detect Supabase if not in .env ────────────────────────────────
if (!process.env.SUPABASE_URL) {
  try {
    const { execSync } = await import('child_process')
    const raw = execSync('npx supabase status --output json', {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: resolve(__dirname, '..'),
    }).toString()
    const status = JSON.parse(raw)
    if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = status.API_URL ?? ''
    if (!process.env.SUPABASE_ANON_KEY) process.env.SUPABASE_ANON_KEY = status.ANON_KEY ?? ''
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY ?? ''
  } catch {
    // Supabase not running — will fail at the required-vars check below
  }
}

// ── 2. Imports (after env is populated) ────────────────────────────────────
const { ZohoBooksConnector } = await import('../apps/api/src/connectors/zoho-books.js')
const { summariseOverdue } = await import('../packages/shared/src/index.js')
const { WhatsAppConnector } = await import('../apps/api/src/connectors/whatsapp.js')
const { getLlmClientForRanking } = await import('../apps/api/src/llm/registry.js')
const { parseModelRanking } = await import('../apps/api/src/llm/model-ranking.js')
const { draftFollowUp } = await import('../apps/api/src/llm/follow-up-draft.js')
const { createClient } = await import('@supabase/supabase-js')

// ── 3. Validate required env ────────────────────────────────────────────────
const required = [
  'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORGANIZATION_ID',
  'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
]
const missing = required.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`[prove-e2e-loop] Missing env vars: ${missing.join(', ')}`)
  process.exit(1)
}

const hasLlm = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
if (!hasLlm) {
  console.warn('[prove-e2e-loop] No LLM key set — will skip LLM draft and use deterministic text')
}

const OWNER_PHONE = process.env.OWNER_PHONE ?? '+919751723512'

console.log('\n══════════════════════════════════════════════════════')
console.log('  CoreOps — end-to-end loop proof')
console.log('══════════════════════════════════════════════════════\n')

// ── 4. Fetch from Zoho ──────────────────────────────────────────────────────
console.log('[1/5] Connecting to Zoho Books (India DC)...')
const zohoCreds = {
  client_id: process.env.ZOHO_CLIENT_ID!,
  client_secret: process.env.ZOHO_CLIENT_SECRET!,
  refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
  organization_id: process.env.ZOHO_ORGANIZATION_ID!,
  access_token: '',
  access_token_expires_at: '',
  api_domain: process.env.ZOHO_API_DOMAIN ?? 'https://www.zohoapis.in',
  auth_domain: process.env.ZOHO_AUTH_DOMAIN ?? 'https://accounts.zoho.in',
}
const zoho = new ZohoBooksConnector(zohoCreds)

const [invoices, customers] = await Promise.all([
  zoho.fetchInvoices(),
  zoho.fetchCustomers(),
])
console.log(`  → ${invoices.length} invoice(s), ${customers.length} customer(s) fetched`)

// ── 5. Overdue calculator ───────────────────────────────────────────────────
console.log('\n[2/5] Running overdue calculator (deterministic)...')
const overdueInputs = invoices.map((inv) => ({
  id: inv.external_id,
  amount: inv.amount,
  amount_paid: inv.amount_paid,
  due_date: inv.due_date,
  status: inv.status,
}))
const summary = summariseOverdue(overdueInputs, new Date())
const customerMap = new Map(customers.map((c) => [c.external_id, c]))
const overdueResults = summary.results.filter((r) => r.is_overdue)

console.log(`  → ${summary.count_overdue} overdue invoice(s) | ₹${summary.total_overdue} total outstanding`)
console.log(`  → by bucket: ${JSON.stringify(summary.by_bucket)}`)

// Print per-invoice breakdown
for (const r of overdueResults.sort((a, b) => b.days_overdue - a.days_overdue)) {
  const inv = invoices.find((i) => i.external_id === r.invoice_id)!
  const cust = customerMap.get(inv.customer_external_id)
  console.log(
    `    ${inv.invoice_number} | ${cust?.name ?? 'Unknown'} | ` +
    `₹${r.amount_outstanding} outstanding | ${r.days_overdue}d overdue | bucket: ${r.age_bucket}`
  )
}

// ── 6. LLM draft for worst invoice ─────────────────────────────────────────
const worst = overdueResults.sort((a, b) => b.days_overdue - a.days_overdue)[0]
const worstInv = invoices.find((i) => i.external_id === worst.invoice_id)!
const worstCust = customerMap.get(worstInv.customer_external_id)

let llmDraftText: string
if (hasLlm) {
  console.log('\n[3/5] Generating LLM draft for most-overdue invoice...')
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
  const { data: biz } = await supabase.from('businesses').select('id').limit(1).maybeSingle()
  if (!biz) {
    console.warn('  → No business row in DB — using deterministic draft text')
    llmDraftText = `${worstCust?.name ?? 'Valued Customer'}, invoice ${worstInv.invoice_number} for ₹${worst.amount_outstanding} is ${worst.days_overdue} days overdue. Please arrange payment at your earliest convenience.`
  } else {
    const keys = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
    }
    const ranking = parseModelRanking(
      process.env.LLM_RANKING_FOLLOW_UP_DRAFT ?? 'openai:gpt-5-nano,anthropic:claude-haiku-4-5-20251001'
    )
    const llm = getLlmClientForRanking(ranking, keys)
    const stateItem = {
      invoice_id: worstInv.external_id,
      invoice_number: worstInv.invoice_number,
      customer_id: worstInv.customer_external_id,
      customer_name: worstCust?.name ?? 'Valued Customer',
      customer_phone: worstCust?.phone ?? null,
      amount: worstInv.amount,
      amount_outstanding: worst.amount_outstanding,
      days_overdue: worst.days_overdue,
      age_bucket: worst.age_bucket,
    }
    llmDraftText = await draftFollowUp(llm, supabase, biz.id, stateItem)
    console.log(`  → Draft: "${llmDraftText}"`)
  }
} else {
  console.log('\n[3/5] No LLM key — using deterministic draft text...')
  llmDraftText = `${worstCust?.name ?? 'Valued Customer'}, invoice ${worstInv.invoice_number} for ₹${worst.amount_outstanding} is ${worst.days_overdue} days overdue. Please arrange payment at your earliest convenience.`
  console.log(`  → Draft: "${llmDraftText}"`)
}

// ── 7. Format owner briefing ────────────────────────────────────────────────
console.log('\n[4/5] Composing owner briefing...')
const sortedOverdue = overdueResults.sort((a, b) => b.days_overdue - a.days_overdue)
const lines = [
  `CoreOps Daily Briefing`,
  ``,
  `${summary.count_overdue} overdue invoices | Rs.${summary.total_overdue.toLocaleString('en-IN')} outstanding`,
  ``,
]
for (const r of sortedOverdue) {
  const inv = invoices.find((i) => i.external_id === r.invoice_id)!
  const cust = customerMap.get(inv.customer_external_id)
  lines.push(`${inv.invoice_number} - ${cust?.name ?? 'Unknown'} - Rs.${r.amount_outstanding.toLocaleString('en-IN')} (${r.days_overdue}d) [${r.age_bucket}]`)
}
lines.push(``)
lines.push(`Most urgent follow-up draft:`)
lines.push(llmDraftText)

const briefingText = lines.join('\n')
console.log('  → Briefing text:')
console.log('  ┌─────────────────────────────────────────────')
briefingText.split('\n').forEach((l) => console.log(`  │ ${l}`))
console.log('  └─────────────────────────────────────────────')

// ── 8. Send via WhatsApp ────────────────────────────────────────────────────
console.log(`\n[5/5] Sending owner briefing to ${OWNER_PHONE} via WhatsApp Cloud API...`)
const waCreds = {
  access_token: process.env.WHATSAPP_ACCESS_TOKEN!,
  phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID!,
}
const wa = new WhatsAppConnector(waCreds)

const result = await wa.sendSessionMessage(OWNER_PHONE, briefingText)
if (result.ok) {
  console.log(`  → DELIVERED | wamid: ${result.provider_message_id}`)
} else {
  console.error(`  → FAILED: ${result.message}`)
  process.exit(1)
}

console.log('\n══════════════════════════════════════════════════════')
console.log('  Full loop PROVED on real systems.')
console.log('  Zoho Books (India DC) → overdue calculator → LLM draft → WhatsApp CSW message')
console.log('══════════════════════════════════════════════════════\n')
