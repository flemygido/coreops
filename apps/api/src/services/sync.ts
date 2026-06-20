// Accounting data sync service.
// Pulls customers, invoices, and payments from a connected accounting source
// (Zoho Books today, Tally/Sheets later) and upserts them into our Postgres
// tables so the receivables workflow runs on live data instead of seed data.
//
// Design principles enforced here:
//  - Source-agnostic: calls the AccountingConnector interface only, never Zoho directly.
//  - Multi-tenant correct: scoped to one businessId; all writes carry business_id.
//  - Idempotent: upserts on (business_id, external_id) — re-running is safe.
//  - No hard-delete: records absent from the source are left as-is (stale but
//    harmless — overdue calc ignores paid/void; see ADR-0008 KNOWN LIMITATION).
//  - Deterministic math: no overdue recalc here; that is getReceivablesState()'s job.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../lib/crypto.js'
import { getAccountingConnector } from '../connectors/registry.js'
import type { ConnectorCredentials, AccountingProvider } from '../connectors/types.js'
import { ACCOUNTING_PROVIDERS } from '../connectors/types.js'

export interface SyncResult {
  status: 'skipped' | 'success' | 'partial' | 'failed'
  provider: string | null
  customers_synced: number
  invoices_synced: number
  payments_synced: number
  error_count: number
  errors: string[]
}

// syncBusiness pulls fresh accounting data from the business's connected
// accounting source and upserts it into our Postgres tables.
//
// Returns 'skipped' if no active accounting connected_account exists — the
// daily workflow proceeds to draft from whatever is already in Postgres.
//
// Uses adminSupabase (service_role) because this runs in a cron job with no
// user context. All writes are manually scoped to businessId.
export async function syncBusiness(
  adminSupabase: SupabaseClient,
  businessId: string
): Promise<SyncResult> {
  // ── 1. Load active accounting connected_account ────────────────────────────
  const { data: account, error: acctErr } = await adminSupabase
    .from('connected_accounts')
    .select('id, provider, credentials_encrypted')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .in('provider', ACCOUNTING_PROVIDERS as unknown as string[])
    .maybeSingle()

  if (acctErr) throw new Error(`Failed to load connected account: ${acctErr.message}`)
  if (!account) {
    return {
      status: 'skipped',
      provider: null,
      customers_synced: 0,
      invoices_synced: 0,
      payments_synced: 0,
      error_count: 0,
      errors: [],
    }
  }

  // We filtered on ACCOUNTING_PROVIDERS in the SQL query, so the cast is safe.
  const provider = account.provider as AccountingProvider

  // ── 2. Decrypt credentials ─────────────────────────────────────────────────
  let credentials: ConnectorCredentials
  try {
    credentials = JSON.parse(decrypt(account.credentials_encrypted)) as ConnectorCredentials
  } catch (e) {
    return {
      status: 'failed',
      provider,
      customers_synced: 0,
      invoices_synced: 0,
      payments_synced: 0,
      error_count: 1,
      errors: [`credential decryption failed: ${(e as Error).message}`],
    }
  }

  // ── 3. Open sync_runs record ───────────────────────────────────────────────
  const { data: runRow, error: runInsertErr } = await adminSupabase
    .from('sync_runs')
    .insert({ business_id: businessId, provider, status: 'running' })
    .select('id')
    .single()

  if (runInsertErr) throw new Error(`Failed to create sync_run: ${runInsertErr.message}`)
  const runId = runRow.id as string

  // ── 4. Instantiate connector (token refresh persists back to DB) ───────────
  const connector = getAccountingConnector(provider, credentials, {
    supabase: adminSupabase,
    connectedAccountId: account.id as string,
  })

  const errors: string[] = []
  let customers_synced = 0
  let invoices_synced = 0
  let payments_synced = 0

  // ── 5. Customers ───────────────────────────────────────────────────────────
  let customerMap = new Map<string, string>() // external_id → internal uuid
  try {
    const customers = await connector.fetchCustomers()

    if (customers.length > 0) {
      const { error: custUpsertErr } = await adminSupabase.from('customers').upsert(
        customers.map((c) => ({
          business_id: businessId,
          external_id: c.external_id,
          name: c.name,
          phone: c.phone ?? null,
          email: c.email ?? null,
        })),
        { onConflict: 'business_id,external_id' }
      )

      if (custUpsertErr) throw new Error(custUpsertErr.message)
      customers_synced = customers.length

      // Resolve external_id → internal uuid for invoice FK linking
      const { data: custRows, error: custSelectErr } = await adminSupabase
        .from('customers')
        .select('id, external_id')
        .eq('business_id', businessId)
        .in(
          'external_id',
          customers.map((c) => c.external_id)
        )

      if (custSelectErr) throw new Error(custSelectErr.message)
      customerMap = new Map(
        (custRows ?? []).map((r: { id: string; external_id: string }) => [r.external_id, r.id])
      )
    }
  } catch (e) {
    errors.push(`customers: ${(e as Error).message}`)
    await finaliseRun(adminSupabase, runId, account.id as string, 'failed', 0, 0, 0, errors)
    return {
      status: 'failed',
      provider,
      customers_synced: 0,
      invoices_synced: 0,
      payments_synced: 0,
      error_count: 1,
      errors,
    }
  }

  // ── 6. Invoices ────────────────────────────────────────────────────────────
  let invoiceMap = new Map<string, string>() // external_id → internal uuid
  try {
    const invoices = await connector.fetchInvoices()

    const invoiceRows = invoices.flatMap((inv) => {
      const customerId = customerMap.get(inv.customer_external_id)
      if (!customerId) return [] // invoice for unknown customer — skip
      return [
        {
          business_id: businessId,
          external_id: inv.external_id,
          customer_id: customerId,
          invoice_number: inv.invoice_number,
          amount: inv.amount,
          amount_paid: inv.amount_paid,
          currency: inv.currency,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          status: inv.status,
        },
      ]
    })

    if (invoiceRows.length > 0) {
      const { error: invUpsertErr } = await adminSupabase
        .from('invoices')
        .upsert(invoiceRows, { onConflict: 'business_id,external_id' })

      if (invUpsertErr) throw new Error(invUpsertErr.message)
      invoices_synced = invoiceRows.length

      const { data: invRows, error: invSelectErr } = await adminSupabase
        .from('invoices')
        .select('id, external_id')
        .eq('business_id', businessId)
        .in(
          'external_id',
          invoices.map((i) => i.external_id)
        )

      if (invSelectErr) throw new Error(invSelectErr.message)
      invoiceMap = new Map(
        (invRows ?? []).map((r: { id: string; external_id: string }) => [r.external_id, r.id])
      )
    }
  } catch (e) {
    errors.push(`invoices: ${(e as Error).message}`)
    // customers succeeded; this is a partial failure
  }

  // ── 7. Payments ────────────────────────────────────────────────────────────
  try {
    const payments = await connector.fetchPayments()

    const paymentRows = payments.flatMap((p) => {
      const invoiceId = invoiceMap.get(p.invoice_external_id)
      if (!invoiceId) return [] // payment for unresolved invoice — skip
      return [
        {
          business_id: businessId,
          external_id: p.external_id,
          invoice_id: invoiceId,
          amount: p.amount,
          paid_at: p.paid_at,
          payment_method: p.payment_method ?? null,
          reference: p.reference ?? null,
        },
      ]
    })

    if (paymentRows.length > 0) {
      // ignoreDuplicates: payments are immutable — skip if already recorded.
      const { error: payUpsertErr } = await adminSupabase
        .from('payments')
        .upsert(paymentRows, { onConflict: 'business_id,external_id', ignoreDuplicates: true })

      if (payUpsertErr) throw new Error(payUpsertErr.message)
      payments_synced = paymentRows.length
    }
  } catch (e) {
    errors.push(`payments: ${(e as Error).message}`)
    // invoices already synced; still partial
  }

  // ── 8. Finalise ────────────────────────────────────────────────────────────
  const status = errors.length === 0 ? 'success' : 'partial'
  await finaliseRun(
    adminSupabase,
    runId,
    account.id as string,
    status,
    customers_synced,
    invoices_synced,
    payments_synced,
    errors
  )

  return {
    status,
    provider,
    customers_synced,
    invoices_synced,
    payments_synced,
    error_count: errors.length,
    errors,
  }
}

// Updates the sync_run row with final status/counts and touches last_synced_at
// on the connected_account (only on success or partial — not on total failure).
async function finaliseRun(
  adminSupabase: SupabaseClient,
  runId: string,
  connectedAccountId: string,
  status: 'success' | 'partial' | 'failed',
  customers_synced: number,
  invoices_synced: number,
  payments_synced: number,
  errors: string[]
): Promise<void> {
  const now = new Date().toISOString()

  await adminSupabase
    .from('sync_runs')
    .update({
      status,
      finished_at: now,
      customers_synced,
      invoices_synced,
      payments_synced,
      error_count: errors.length,
      error_detail: errors.length > 0 ? errors : null,
    })
    .eq('id', runId)

  if (status !== 'failed') {
    await adminSupabase
      .from('connected_accounts')
      .update({ last_synced_at: now })
      .eq('id', connectedAccountId)
  }
}
