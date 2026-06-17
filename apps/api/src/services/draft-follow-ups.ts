// Drafts follow-up messages for every overdue invoice that doesn't already
// have a non-skipped follow-up in the pipeline. Called by the daily cron job
// and the manual workflow trigger. Idempotent: re-running produces no
// duplicates — invoices with an existing draft/approved/sent/failed are skipped.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getReceivablesState } from './receivables-state.js'
import { draftFollowUp } from '../llm/follow-up-draft.js'
import type { LlmClient } from '../llm/types.js'

export interface DraftFollowUpsResult {
  drafted: number
  skipped_already_pending: number
  failed: number
  errors: Array<{ invoice_id: string; message: string }>
}

export async function draftFollowUps(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  businessId: string,
  llm: LlmClient
): Promise<DraftFollowUpsResult> {
  const state = await getReceivablesState(supabase, businessId)

  if (state.overdue_invoices.length === 0) {
    return { drafted: 0, skipped_already_pending: 0, failed: 0, errors: [] }
  }

  // Find invoice IDs that already have an active (non-skipped) follow-up
  const invoiceIds = state.overdue_invoices.map((i) => i.invoice_id)
  const { data: existing } = await supabase
    .from('follow_ups')
    .select('invoice_id')
    .eq('business_id', businessId)
    .in('invoice_id', invoiceIds)
    .in('status', ['draft', 'approved', 'sent', 'failed'])

  const pendingInvoiceIds = new Set(
    (existing ?? []).map((r: { invoice_id: string }) => r.invoice_id)
  )

  const result: DraftFollowUpsResult = {
    drafted: 0,
    skipped_already_pending: 0,
    failed: 0,
    errors: [],
  }

  for (const invoice of state.overdue_invoices) {
    if (pendingInvoiceIds.has(invoice.invoice_id)) {
      result.skipped_already_pending++
      continue
    }

    try {
      const draftedText = await draftFollowUp(llm, adminSupabase, businessId, invoice)

      const { error } = await supabase.from('follow_ups').insert({
        business_id: businessId,
        invoice_id: invoice.invoice_id,
        customer_id: invoice.customer_id,
        drafted_text: draftedText,
        status: 'draft',
      })

      if (error) throw new Error(error.message)
      result.drafted++
    } catch (err) {
      result.failed++
      result.errors.push({
        invoice_id: invoice.invoice_id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}
