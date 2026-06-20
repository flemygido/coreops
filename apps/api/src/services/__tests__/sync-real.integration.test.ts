// Live integration test for syncBusiness() against real Zoho Books trial account + local Supabase.
// Gated on ZOHO_ORGANIZATION_ID + SUPABASE_SERVICE_ROLE_KEY — skipped in CI.
// Also skipped if no zoho_books connected_account exists in DB (run setup-pilot.mts first).
//
// To run:
//   supabase start (local instance must be running)
//   node --import tsx/esm scripts/setup-pilot.mts --email ... --business-name ... --consent-confirmed
//   npm run test:live-sync -w apps/api
//
// What it proves:
//   1. syncBusiness() calls Zoho, upserts customers + invoices into Postgres
//   2. getReceivablesState() returns live data (≥1 overdue, total_overdue > 0)
//   3. Running sync again leaves row count unchanged (idempotency)
//   4. sync_runs table has a 'success' row for each run

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { syncBusiness } from '../sync.js'
import { getReceivablesState } from '../receivables-state.js'

// ── Gate ─────────────────────────────────────────────────────────────────────

const hasZoho = Boolean(
  process.env.ZOHO_CLIENT_ID &&
  process.env.ZOHO_CLIENT_SECRET &&
  process.env.ZOHO_REFRESH_TOKEN &&
  process.env.ZOHO_ORGANIZATION_ID
)
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
const shouldRun = hasZoho && hasSupabase

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdminClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe.skipIf(!shouldRun)('syncBusiness() — live Zoho + local Supabase', () => {
  // Setup state populated in beforeAll; individual tests skip() if null.
  let setup: {
    adminSupabase: ReturnType<typeof makeAdminClient>
    businessId: string
    connectedAccountId: string
  } | null = null

  beforeAll(async () => {
    const adminSupabase = makeAdminClient()

    // Find the business that has an active zoho_books connected_account.
    // Uses connected_accounts as the anchor — not the first business — so
    // seed-data businesses (which have no connector) are skipped automatically.
    const { data: acct, error: acctErr } = await adminSupabase
      .from('connected_accounts')
      .select('id, business_id, provider, is_active')
      .eq('provider', 'zoho_books')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (acctErr || !acct) {
      console.warn(
        '[sync live] No active zoho_books connected_account found — ' +
          'run scripts/setup-pilot.mts first to provision credentials.'
      )
      return
    }

    const businessId = (acct as { business_id: string }).business_id
    const connectedAccountId = (acct as { id: string }).id
    console.log('[sync live] businessId:', businessId)
    console.log('[sync live] connectedAccountId:', connectedAccountId)
    setup = { adminSupabase, businessId, connectedAccountId }
  })

  afterAll(async () => {
    if (!setup) return
    // Clean up sync_runs rows created during this test run
    await setup.adminSupabase.from('sync_runs').delete().eq('business_id', setup.businessId)
  })

  // ── 1. First sync run ────────────────────────────────────────────────────────

  it('returns status:success on first sync', async (ctx) => {
    if (!setup) return ctx.skip()
    const { adminSupabase, businessId } = setup
    const result = await syncBusiness(adminSupabase, businessId)
    console.log('[sync live] first sync result:', JSON.stringify(result))
    expect(result.status).toBe('success')
    expect(result.provider).toBe('zoho_books')
    expect(result.error_count).toBe(0)
    expect(result.errors).toHaveLength(0)
  }, 30_000)

  it('syncs at least 1 customer and 1 invoice', async (ctx) => {
    if (!setup) return ctx.skip()
    const { adminSupabase, businessId } = setup
    const { data: customers } = await adminSupabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
    const { data: invoices } = await adminSupabase
      .from('invoices')
      .select('id')
      .eq('business_id', businessId)

    console.log('[sync live] customers in DB:', customers?.length)
    console.log('[sync live] invoices in DB:', invoices?.length)

    expect((customers ?? []).length).toBeGreaterThanOrEqual(1)
    expect((invoices ?? []).length).toBeGreaterThanOrEqual(1)
  })

  // ── 2. Receivables state reflects live Zoho data ──────────────────────────

  it('getReceivablesState() returns live data with at least 1 overdue invoice', async (ctx) => {
    if (!setup) return ctx.skip()
    const { adminSupabase, businessId } = setup
    const state = await getReceivablesState(adminSupabase, businessId)
    console.log('[sync live] state:', {
      total_outstanding: state.total_outstanding,
      total_overdue: state.total_overdue,
      count_overdue: state.count_overdue,
    })
    expect(state.business_id).toBe(businessId)
    expect(state.total_overdue).toBeGreaterThan(0)
    expect(state.count_overdue).toBeGreaterThanOrEqual(1)
    expect(state.overdue_invoices.length).toBeGreaterThanOrEqual(1)
    const first = state.overdue_invoices[0]
    expect(first.invoice_number).toBeTruthy()
    expect(first.customer_name).toBeTruthy()
    expect(first.amount).toBeGreaterThan(0)
    expect(first.days_overdue).toBeGreaterThan(0)
  })

  // ── 3. Idempotency — second sync leaves row counts unchanged ──────────────

  it('running sync again does not create duplicate customers or invoices', async (ctx) => {
    if (!setup) return ctx.skip()
    const { adminSupabase, businessId } = setup
    const { data: custsBefore } = await adminSupabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
    const { data: invsBefore } = await adminSupabase
      .from('invoices')
      .select('id')
      .eq('business_id', businessId)

    const result2 = await syncBusiness(adminSupabase, businessId)
    console.log('[sync live] second sync result:', JSON.stringify(result2))
    expect(result2.status).toBe('success')

    const { data: custsAfter } = await adminSupabase
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
    const { data: invsAfter } = await adminSupabase
      .from('invoices')
      .select('id')
      .eq('business_id', businessId)

    expect(custsAfter?.length).toBe(custsBefore?.length)
    expect(invsAfter?.length).toBe(invsBefore?.length)
  }, 30_000)

  // ── 4. sync_runs audit log ────────────────────────────────────────────────

  it('creates a sync_runs row with status:success for each run', async (ctx) => {
    if (!setup) return ctx.skip()
    const { adminSupabase, businessId } = setup
    const { data: runs, error } = await adminSupabase
      .from('sync_runs')
      .select('id, status, provider, customers_synced, invoices_synced, finished_at')
      .eq('business_id', businessId)
      .order('started_at', { ascending: false })

    expect(error).toBeNull()
    expect((runs ?? []).length).toBeGreaterThanOrEqual(2)
    for (const run of (runs ?? []) as Array<{
      status: string
      provider: string
      finished_at: string
    }>) {
      expect(run.status).toBe('success')
      expect(run.provider).toBe('zoho_books')
      expect(run.finished_at).toBeTruthy()
    }
  })

  // ── 5. connected_accounts.last_synced_at was updated ─────────────────────

  it('updates connected_account.last_synced_at after sync', async (ctx) => {
    if (!setup) return ctx.skip()
    const { adminSupabase, connectedAccountId } = setup
    const { data: acct } = await adminSupabase
      .from('connected_accounts')
      .select('last_synced_at')
      .eq('id', connectedAccountId)
      .single()

    console.log(
      '[sync live] last_synced_at:',
      (acct as { last_synced_at: string } | null)?.last_synced_at
    )
    expect((acct as { last_synced_at: string } | null)?.last_synced_at).toBeTruthy()
  })
})
