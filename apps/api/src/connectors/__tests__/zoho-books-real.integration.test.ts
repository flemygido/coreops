// Live integration tests for ZohoBooksConnector against the real Zoho Books trial account.
// Gated on ZOHO_ORGANIZATION_ID being set in .env — skipped in CI and local
// environments without credentials.
//
// To activate: set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN,
// ZOHO_ORGANIZATION_ID in .env (India trial account).
// Run:  npx vitest run --reporter=verbose apps/api/src/connectors/__tests__/zoho-books-real.integration.test.ts
//
// The connector will exchange ZOHO_REFRESH_TOKEN for a fresh access_token on first call.
// No connected_accounts DB row needed — credentials are built inline from env vars.

import { describe, it, expect, beforeAll } from 'vitest'
import { ZohoBooksConnector } from '../zoho-books.js'
import { calculateOverdue, summariseOverdue } from '@coreops/shared'
import type { ConnectorCredentials } from '../types.js'
import type { OverdueInput } from '@coreops/shared'

const hasZoho = Boolean(
  process.env.ZOHO_CLIENT_ID &&
  process.env.ZOHO_CLIENT_SECRET &&
  process.env.ZOHO_REFRESH_TOKEN &&
  process.env.ZOHO_ORGANIZATION_ID
)

describe.skipIf(!hasZoho)('ZohoBooksConnector — live Zoho Books trial', () => {
  let connector: ZohoBooksConnector
  let creds: ConnectorCredentials

  beforeAll(() => {
    creds = {
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
      organization_id: process.env.ZOHO_ORGANIZATION_ID!,
      // access_token intentionally left empty — connector will refresh via refresh_token
      access_token: '',
      access_token_expires_at: '',
      api_domain: process.env.ZOHO_API_DOMAIN ?? 'https://www.zohoapis.in',
      auth_domain: process.env.ZOHO_AUTH_DOMAIN ?? 'https://accounts.zoho.in',
    }
    connector = new ZohoBooksConnector(creds)
  })

  // ── 1. Auth + connectivity ──────────────────────────────────────────────────

  it('testConnection() returns ok: true and org name', async () => {
    const result = await connector.testConnection()
    console.log('[Zoho live] testConnection:', result.message)
    expect(result.ok).toBe(true)
    expect(result.message).toMatch(/Connected to Zoho Books/)
  }, 30_000)

  // ── 2. Customers ────────────────────────────────────────────────────────────

  it('fetchCustomers() returns at least one contact', async () => {
    const customers = await connector.fetchCustomers()
    console.log(`[Zoho live] fetchCustomers: ${customers.length} contact(s)`)
    // Print first 3 (redact email/phone for logs)
    customers.slice(0, 3).forEach((c) => {
      console.log(
        `  ${c.external_id} | ${c.name} | phone: ${c.phone ? '[redacted]' : 'null'} | email: ${c.email ? '[redacted]' : 'null'}`
      )
    })
    expect(customers.length).toBeGreaterThan(0)
    expect(customers[0].external_id).toBeTruthy()
    expect(customers[0].name).toBeTruthy()
  }, 30_000)

  // ── 3. Invoices + overdue classification ────────────────────────────────────

  it('fetchInvoices() returns invoices with at least one overdue', async () => {
    const invoices = await connector.fetchInvoices()
    console.log(`[Zoho live] fetchInvoices: ${invoices.length} invoice(s)`)

    invoices.slice(0, 5).forEach((inv) => {
      console.log(
        `  ${inv.invoice_number} | customer: ${inv.customer_external_id} | ` +
          `total: ₹${inv.amount} | balance: ₹${inv.amount - inv.amount_paid} | ` +
          `due: ${inv.due_date} | status: ${inv.status}`
      )
    })

    expect(invoices.length).toBeGreaterThan(0)

    // Run through our deterministic overdue calculator
    const overdueInputs: OverdueInput[] = invoices.map((inv) => ({
      id: inv.external_id,
      amount: inv.amount,
      amount_paid: inv.amount_paid,
      due_date: inv.due_date,
      status: inv.status,
    }))

    const summary = summariseOverdue(overdueInputs, new Date())
    console.log(
      `[Zoho live] overdue summary: ${summary.count_overdue} overdue, ` +
        `₹${summary.total_overdue} outstanding`
    )
    console.log('  by_bucket:', JSON.stringify(summary.by_bucket))

    expect(summary.count_overdue).toBeGreaterThan(0)
  }, 30_000)

  // ── 4. Payments ─────────────────────────────────────────────────────────────

  it('fetchPayments() returns payments linked to invoices', async () => {
    const payments = await connector.fetchPayments()
    console.log(`[Zoho live] fetchPayments: ${payments.length} payment(s)`)
    payments.slice(0, 3).forEach((p) => {
      console.log(
        `  ${p.external_id} | invoice: ${p.invoice_external_id} | ` +
          `₹${p.amount} | ${p.paid_at} | mode: ${p.payment_method}`
      )
    })
    // Payments list may be empty if all invoices are new — not a failure condition
    for (const p of payments) {
      expect(p.external_id).toBeTruthy()
      expect(p.invoice_external_id).toBeTruthy()
      expect(p.amount).toBeGreaterThan(0)
    }
  }, 30_000)

  // ── 5. End-to-end: real Zoho data → overdue calculator → drafted follow-up ──

  it('real overdue invoices feed through the unchanged overdue calculator and produce a correct draft', async () => {
    const [invoices, customers] = await Promise.all([
      connector.fetchInvoices(),
      connector.fetchCustomers(),
    ])

    // Build lookup for customer names (same as what the sync service will do)
    const customerMap = new Map(customers.map((c) => [c.external_id, c]))

    const overdueInputs: OverdueInput[] = invoices.map((inv) => ({
      id: inv.external_id,
      amount: inv.amount,
      amount_paid: inv.amount_paid,
      due_date: inv.due_date,
      status: inv.status,
    }))

    const summary = summariseOverdue(overdueInputs, new Date())
    const overdueResults = summary.results.filter((r) => r.is_overdue)

    expect(overdueResults.length).toBeGreaterThan(0)

    // Pick the most-overdue invoice for the draft test
    const worst = overdueResults.sort((a, b) => b.days_overdue - a.days_overdue)[0]
    const invoice = invoices.find((i) => i.external_id === worst.invoice_id)!
    const customer = customerMap.get(invoice.customer_external_id)

    console.log(
      `[Zoho live] e2e: most-overdue invoice ${invoice.invoice_number} | ` +
        `customer: ${customer?.name ?? '[unknown]'} | ` +
        `₹${worst.amount_outstanding} outstanding | ${worst.days_overdue} days overdue`
    )

    // Verify the calculator produced sensible output — deterministic, no LLM needed here
    expect(worst.amount_outstanding).toBeGreaterThan(0)
    expect(worst.days_overdue).toBeGreaterThan(0)
    expect(worst.is_overdue).toBe(true)

    // Directly verify the overdue result for this specific invoice
    const singleResult = calculateOverdue(
      {
        id: invoice.external_id,
        amount: invoice.amount,
        amount_paid: invoice.amount_paid,
        due_date: invoice.due_date,
        status: invoice.status,
      },
      new Date()
    )
    expect(singleResult.is_overdue).toBe(true)
    expect(singleResult.amount_outstanding).toBe(worst.amount_outstanding)

    // Draft generation: import the LLM layer and produce a real draft
    // Uses the same LLM path as the production workflow (model-ranking selects cheapest configured provider)
    const hasLlm = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
    if (!hasLlm) {
      console.log('[Zoho live] e2e: skipping draft generation (no LLM key set)')
      return
    }

    const { createClient } = await import('@supabase/supabase-js')
    const { draftFollowUp } = await import('../../llm/follow-up-draft.js')
    const { getLlmClientForRanking } = await import('../../llm/registry.js')
    const { parseModelRanking } = await import('../../llm/model-ranking.js')

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Find an existing business row (created by scripts/create-owner.mts or seed).
    // We need a real FK-valid business_id so llm_usage_log can insert successfully.
    const { data: biz } = await supabase.from('businesses').select('id').limit(1).maybeSingle()
    if (!biz) {
      console.log(
        '[Zoho live] e2e: skipping LLM draft — no business row in DB. ' +
          'Run `npx tsx scripts/create-owner.mts` first to create one.'
      )
      return
    }
    const BUSINESS_ID = biz.id
    console.log(`[Zoho live] e2e: using business_id ${BUSINESS_ID} for LLM usage log`)

    const keys = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
    }
    const ranking = parseModelRanking(
      process.env.LLM_RANKING_FOLLOW_UP_DRAFT ??
        'openai:gpt-5-nano,anthropic:claude-haiku-4-5-20251001'
    )
    const llm = getLlmClientForRanking(ranking, keys)

    // Build a ReceivablesStateItem from real Zoho data — same shape the production workflow uses
    const stateItem = {
      invoice_id: invoice.external_id,
      invoice_number: invoice.invoice_number,
      customer_id: invoice.customer_external_id,
      customer_name: customer?.name ?? 'Valued Customer',
      customer_phone: customer?.phone ?? null,
      amount: invoice.amount,
      amount_outstanding: worst.amount_outstanding,
      days_overdue: worst.days_overdue,
      age_bucket: worst.age_bucket,
    }

    const draftText = await draftFollowUp(llm, supabase, BUSINESS_ID, stateItem)

    console.log('[Zoho live] e2e: drafted follow-up text:')
    console.log('---')
    console.log(draftText)
    console.log('---')

    expect(draftText.length).toBeGreaterThan(20)
    // Guardrails require the amount outstanding to appear in the draft (grounding check)
    const amountStr = String(Math.round(worst.amount_outstanding))
    expect(draftText.replace(/[₹,]/g, '')).toMatch(amountStr)
  }, 90_000)
})
