// Assembles "today's receivables state" for a business.
// Fetches invoices + customers from DB, runs the deterministic overdue calculator.
// The LLM will use this output in Phase 4 to generate the briefing text.

import type { SupabaseClient } from '@supabase/supabase-js'
import { summariseOverdue, type OverdueSummary } from '@coreops/shared'
import type { Customer, InvoiceStatus } from '@coreops/shared'

// Partial invoice row — only the fields we SELECT from the DB
interface InvoiceRow {
  id: string
  customer_id: string
  invoice_number: string
  amount: number
  amount_paid: number
  due_date: string
  status: string
}

export interface ReceivablesStateItem {
  invoice_id: string
  invoice_number: string
  customer_id: string
  customer_name: string
  customer_phone: string | null
  amount: number
  amount_outstanding: number
  days_overdue: number
  age_bucket: string
}

export interface ReceivablesState {
  as_of: string
  business_id: string
  total_outstanding: number
  total_overdue: number
  count_overdue: number
  by_bucket: OverdueSummary['by_bucket']
  overdue_invoices: ReceivablesStateItem[]
}

export async function getReceivablesState(
  supabase: SupabaseClient,
  businessId: string,
  asOf: Date = new Date()
): Promise<ReceivablesState> {
  // Fetch only open/partial invoices — paid/void/written_off are never overdue
  const { data: invoices, error: invErr } = await supabase
    .from('invoices')
    .select('id, customer_id, invoice_number, amount, amount_paid, due_date, status')
    .eq('business_id', businessId)
    .in('status', ['open', 'partial'])

  if (invErr) throw new Error(`Failed to fetch invoices: ${invErr.message}`)

  // Fetch customers for these invoices (to attach names + phones)
  const allInvoicesRaw: InvoiceRow[] = (invoices ?? []) as InvoiceRow[]
  const customerIds = [...new Set(allInvoicesRaw.map((i) => i.customer_id))]
  const customerMap = new Map<string, { name: string; phone: string | null }>()

  if (customerIds.length > 0) {
    const { data: customers, error: custErr } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('business_id', businessId)
      .in('id', customerIds)

    if (custErr) throw new Error(`Failed to fetch customers: ${custErr.message}`)
    for (const c of (customers ?? []) as Customer[]) {
      customerMap.set(c.id, { name: c.name, phone: c.phone })
    }
  }

  const summary = summariseOverdue(
    allInvoicesRaw.map((inv) => ({
      id: inv.id,
      amount: inv.amount,
      amount_paid: inv.amount_paid,
      due_date: inv.due_date,
      status: inv.status as InvoiceStatus,
    })),
    asOf
  )

  // Build the detailed list — only overdue invoices, sorted by days overdue desc
  const overdueInvoices: ReceivablesStateItem[] = summary.results
    .filter((r) => r.is_overdue)
    .sort((a, b) => b.days_overdue - a.days_overdue)
    .map((r) => {
      const inv = allInvoicesRaw.find((i) => i.id === r.invoice_id)!
      const customer = customerMap.get(inv.customer_id) ?? { name: 'Unknown', phone: null }
      return {
        invoice_id: r.invoice_id,
        invoice_number: inv.invoice_number,
        customer_id: inv.customer_id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        amount: inv.amount,
        amount_outstanding: r.amount_outstanding,
        days_overdue: r.days_overdue,
        age_bucket: r.age_bucket,
      }
    })

  return {
    as_of: asOf.toISOString(),
    business_id: businessId,
    total_outstanding: summary.total_outstanding,
    total_overdue: summary.total_overdue,
    count_overdue: summary.count_overdue,
    by_bucket: summary.by_bucket,
    overdue_invoices: overdueInvoices,
  }
}
