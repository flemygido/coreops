// Deterministic overdue calculator — NO LLM, NO database calls.
// All inputs are plain values; output is fully derived from them.
// This is the single source of truth for "is this invoice overdue and by how much."

import type { InvoiceStatus } from './types/schema.js'

export type AgeBucket = 'not_due' | 'current' | '1-30' | '31-60' | '61-90' | '90+'

export interface OverdueInput {
  id: string
  amount: number
  amount_paid: number
  due_date: string // ISO date YYYY-MM-DD
  status: InvoiceStatus
}

export interface OverdueResult {
  invoice_id: string
  amount_outstanding: number
  days_overdue: number // 0 if not yet due
  age_bucket: AgeBucket
  is_overdue: boolean
}

/**
 * Returns how overdue an invoice is as of `asOf`.
 * Pure function — same inputs always produce the same output.
 *
 * Rules:
 * - Paid, void, or written_off invoices are never overdue.
 * - Credit notes (amount_paid > amount) are not overdue.
 * - days_overdue is floored to whole days; fractional days round down.
 */
export function calculateOverdue(invoice: OverdueInput, asOf: Date): OverdueResult {
  // Terminal statuses: trust the accounting system's decision, not the amounts.
  // An invoice marked paid/void/written_off has zero outstanding regardless of amount_paid sync lag.
  if (invoice.status === 'paid' || invoice.status === 'void' || invoice.status === 'written_off') {
    return {
      invoice_id: invoice.id,
      amount_outstanding: 0,
      days_overdue: 0,
      age_bucket: 'current',
      is_overdue: false,
    }
  }

  const amountOutstanding = Math.max(0, invoice.amount - invoice.amount_paid)

  // Fully covered by payments (credit note / advance payment)
  if (amountOutstanding === 0) {
    return {
      invoice_id: invoice.id,
      amount_outstanding: 0,
      days_overdue: 0,
      age_bucket: 'current',
      is_overdue: false,
    }
  }

  const dueDate = parseDateUTC(invoice.due_date)
  const asOfDay = startOfDayUTC(asOf)

  const diffMs = asOfDay.getTime() - dueDate.getTime()
  const daysOverdue = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (daysOverdue < 0) {
    return {
      invoice_id: invoice.id,
      amount_outstanding: amountOutstanding,
      days_overdue: 0,
      age_bucket: 'not_due',
      is_overdue: false,
    }
  }

  return {
    invoice_id: invoice.id,
    amount_outstanding: amountOutstanding,
    days_overdue: daysOverdue,
    age_bucket: toAgeBucket(daysOverdue),
    is_overdue: daysOverdue >= 0,
  }
}

/** Classify a set of invoices and return summary totals. */
export interface OverdueSummary {
  results: OverdueResult[]
  total_outstanding: number
  total_overdue: number
  count_overdue: number
  by_bucket: Record<AgeBucket, { count: number; amount: number }>
}

export function summariseOverdue(invoices: OverdueInput[], asOf: Date): OverdueSummary {
  const results = invoices.map((inv) => calculateOverdue(inv, asOf))

  const emptyBuckets = (): Record<AgeBucket, { count: number; amount: number }> => ({
    not_due: { count: 0, amount: 0 },
    current: { count: 0, amount: 0 },
    '1-30': { count: 0, amount: 0 },
    '31-60': { count: 0, amount: 0 },
    '61-90': { count: 0, amount: 0 },
    '90+': { count: 0, amount: 0 },
  })

  const by_bucket = emptyBuckets()
  let total_outstanding = 0
  let total_overdue = 0
  let count_overdue = 0

  for (const r of results) {
    total_outstanding += r.amount_outstanding
    by_bucket[r.age_bucket].count += 1
    by_bucket[r.age_bucket].amount += r.amount_outstanding

    if (r.is_overdue) {
      total_overdue += r.amount_outstanding
      count_overdue += 1
    }
  }

  return { results, total_outstanding, total_overdue, count_overdue, by_bucket }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toAgeBucket(daysOverdue: number): AgeBucket {
  if (daysOverdue === 0) return 'current'
  if (daysOverdue <= 30) return '1-30'
  if (daysOverdue <= 60) return '31-60'
  if (daysOverdue <= 90) return '61-90'
  return '90+'
}

/** Parse an ISO date string (YYYY-MM-DD) as midnight UTC. */
function parseDateUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** Strip time component — midnight UTC for the given date. */
function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
