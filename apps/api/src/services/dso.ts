// DSO (Days Sales Outstanding) and rupees-recovered calculation.
// These are the two primary pilot success metrics (CLAUDE.md: "reduction in
// DSO OR rupees of overdue receivables recovered within a 30-day pilot").
//
// CLAUDE.md Hard Rule #6: this is arithmetic, not LLM. No model touches these figures.

import type { SupabaseClient } from '@supabase/supabase-js'
import { calcDsoDays, calcRupeesRecovered } from '@coreops/shared'

export type {} // keep file as a module
export { calcDsoDays, calcRupeesRecovered }

export interface DsoResult {
  accounts_receivable: number // Total outstanding across all open/partial invoices (₹)
  credit_sales_30d: number // Invoice amounts issued in the last 30 calendar days (₹)
  dso_days: number | null // null when credit_sales_30d = 0 (undefined, not infinite)
  rupees_recovered: number // Invoices with a sent follow-up that are now fully paid (₹)
  follow_ups_sent: number // Total sent follow-ups for this business
}

export async function calculateDso(
  supabase: SupabaseClient,
  businessId: string
): Promise<DsoResult> {
  // 1. Total accounts receivable: sum outstanding on all open/partial invoices
  const { data: openInvoices, error: e1 } = await supabase
    .from('invoices')
    .select('amount, amount_paid')
    .eq('business_id', businessId)
    .in('status', ['open', 'partial'])
  if (e1) throw new Error(`DSO: AR query failed: ${e1.message}`)

  const accountsReceivable = (openInvoices ?? []).reduce(
    (s, inv) => s + Number(inv.amount) - Number(inv.amount_paid),
    0
  )

  // 2. Credit sales in last 30 days: invoice amounts billed in the window
  const cutoffDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 30)
  const cutoff = cutoffDate.toISOString().split('T')[0]

  const { data: recentInvoices, error: e2 } = await supabase
    .from('invoices')
    .select('amount')
    .eq('business_id', businessId)
    .gte('issue_date', cutoff)
  if (e2) throw new Error(`DSO: credit-sales query failed: ${e2.message}`)

  const creditSales30d = (recentInvoices ?? []).reduce((s, inv) => s + Number(inv.amount), 0)

  // 3. Rupees recovered: invoices that CoreOps touched (sent) and are now paid
  const { data: sentFu, error: e3 } = await supabase
    .from('follow_ups')
    .select('invoice_id')
    .eq('business_id', businessId)
    .eq('status', 'sent')
  if (e3) throw new Error(`DSO: sent follow-ups query failed: ${e3.message}`)

  const sentInvoiceIds = (sentFu ?? []).map((fu: { invoice_id: string }) => fu.invoice_id)
  const followUpsSent = sentInvoiceIds.length

  let rupeesRecovered = 0
  if (sentInvoiceIds.length > 0) {
    const { data: touchedInvoices, error: e4 } = await supabase
      .from('invoices')
      .select('amount, amount_paid')
      .eq('business_id', businessId)
      .in('id', sentInvoiceIds)
    if (e4) throw new Error(`DSO: touched-invoices query failed: ${e4.message}`)
    rupeesRecovered = calcRupeesRecovered(touchedInvoices ?? [])
  }

  return {
    accounts_receivable: accountsReceivable,
    credit_sales_30d: creditSales30d,
    dso_days: calcDsoDays(accountsReceivable, creditSales30d),
    rupees_recovered: rupeesRecovered,
    follow_ups_sent: followUpsSent,
  }
}

// Records a DSO snapshot for the current date.
// Uses upsert so the weekly cron can safely re-run without duplicates.
export async function recordDsoSnapshot(
  supabase: SupabaseClient,
  businessId: string
): Promise<void> {
  const result = await calculateDso(supabase, businessId)
  const today = new Date().toISOString().split('T')[0]

  const { error } = await supabase.from('dso_snapshots').upsert(
    {
      business_id: businessId,
      snapshot_date: today,
      accounts_receivable: result.accounts_receivable,
      credit_sales_30d: result.credit_sales_30d,
      dso_days: result.dso_days,
      rupees_recovered: result.rupees_recovered,
      follow_ups_sent: result.follow_ups_sent,
    },
    { onConflict: 'business_id,snapshot_date' }
  )

  if (error) throw new Error(`DSO snapshot failed: ${error.message}`)
}
