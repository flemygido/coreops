import { describe, it, expect } from 'vitest'
import { calculateOverdue, summariseOverdue } from '../overdue.js'
import type { OverdueInput } from '../overdue.js'

const asOf = new Date('2026-06-15T12:00:00Z') // noon UTC — should not affect day calc

function invoice(overrides: Partial<OverdueInput> & { due_date: string }): OverdueInput {
  return {
    id: 'inv-001',
    amount: 10000,
    amount_paid: 0,
    status: 'open',
    ...overrides,
  }
}

// ── Status-based short-circuits ───────────────────────────────────────────────

describe('paid invoice', () => {
  it('is never overdue regardless of age', () => {
    const r = calculateOverdue(invoice({ due_date: '2025-01-01', status: 'paid' }), asOf)
    expect(r.is_overdue).toBe(false)
    expect(r.days_overdue).toBe(0)
  })
})

describe('void invoice', () => {
  it('is never overdue', () => {
    const r = calculateOverdue(invoice({ due_date: '2025-01-01', status: 'void' }), asOf)
    expect(r.is_overdue).toBe(false)
  })
})

describe('written_off invoice', () => {
  it('is never overdue', () => {
    const r = calculateOverdue(invoice({ due_date: '2025-01-01', status: 'written_off' }), asOf)
    expect(r.is_overdue).toBe(false)
  })
})

// ── Future / not yet due ──────────────────────────────────────────────────────

describe('future due date', () => {
  it('returns not_due bucket with 0 days overdue', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-12-31' }), asOf)
    expect(r.is_overdue).toBe(false)
    expect(r.days_overdue).toBe(0)
    expect(r.age_bucket).toBe('not_due')
  })
})

// ── Due today ─────────────────────────────────────────────────────────────────

describe('due today', () => {
  it('returns current bucket, 0 days overdue, is_overdue true', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-06-15' }), asOf)
    expect(r.is_overdue).toBe(true)
    expect(r.days_overdue).toBe(0)
    expect(r.age_bucket).toBe('current')
  })
})

// ── Age buckets ───────────────────────────────────────────────────────────────

describe('age buckets', () => {
  it('1 day overdue → 1-30 bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-06-14' }), asOf)
    expect(r.days_overdue).toBe(1)
    expect(r.age_bucket).toBe('1-30')
    expect(r.is_overdue).toBe(true)
  })

  it('30 days overdue → 1-30 bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-05-16' }), asOf)
    expect(r.days_overdue).toBe(30)
    expect(r.age_bucket).toBe('1-30')
  })

  it('31 days overdue → 31-60 bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-05-15' }), asOf)
    expect(r.days_overdue).toBe(31)
    expect(r.age_bucket).toBe('31-60')
  })

  it('60 days overdue → 31-60 bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-04-16' }), asOf)
    expect(r.days_overdue).toBe(60)
    expect(r.age_bucket).toBe('31-60')
  })

  it('61 days overdue → 61-90 bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-04-15' }), asOf)
    expect(r.days_overdue).toBe(61)
    expect(r.age_bucket).toBe('61-90')
  })

  it('90 days overdue → 61-90 bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-03-17' }), asOf)
    expect(r.days_overdue).toBe(90)
    expect(r.age_bucket).toBe('61-90')
  })

  it('91 days overdue → 90+ bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2026-03-16' }), asOf)
    expect(r.days_overdue).toBe(91)
    expect(r.age_bucket).toBe('90+')
  })

  it('very old invoice → 90+ bucket', () => {
    const r = calculateOverdue(invoice({ due_date: '2024-01-01' }), asOf)
    expect(r.age_bucket).toBe('90+')
    expect(r.is_overdue).toBe(true)
  })
})

// ── Partial payments ──────────────────────────────────────────────────────────

describe('partial payment', () => {
  it('outstanding = amount - amount_paid', () => {
    const r = calculateOverdue(
      invoice({ due_date: '2026-05-01', amount: 10000, amount_paid: 4000, status: 'partial' }),
      asOf
    )
    expect(r.amount_outstanding).toBe(6000)
    expect(r.is_overdue).toBe(true)
  })

  it('fully covered partial (amount_paid >= amount) → not overdue', () => {
    const r = calculateOverdue(
      invoice({ due_date: '2026-05-01', amount: 10000, amount_paid: 10000, status: 'partial' }),
      asOf
    )
    expect(r.amount_outstanding).toBe(0)
    expect(r.is_overdue).toBe(false)
  })
})

// ── Credit note (overpayment) ─────────────────────────────────────────────────

describe('credit note / overpayment', () => {
  it('amount_paid > amount → outstanding = 0, not overdue', () => {
    const r = calculateOverdue(
      invoice({ due_date: '2026-05-01', amount: 10000, amount_paid: 12000 }),
      asOf
    )
    expect(r.amount_outstanding).toBe(0)
    expect(r.is_overdue).toBe(false)
  })
})

// ── Timezone safety ───────────────────────────────────────────────────────────

describe('timezone edge case', () => {
  it('date calculation is independent of local timezone offset', () => {
    // asOf is noon UTC on 2026-06-15; due_date is 2026-06-15
    // Regardless of server timezone, this should be 0 days overdue
    const r = calculateOverdue(
      invoice({ due_date: '2026-06-15' }),
      new Date('2026-06-15T23:59:00Z')
    )
    expect(r.days_overdue).toBe(0)

    const r2 = calculateOverdue(
      invoice({ due_date: '2026-06-15' }),
      new Date('2026-06-15T00:01:00Z')
    )
    expect(r2.days_overdue).toBe(0)
  })

  it('one day boundary is exact', () => {
    const r = calculateOverdue(
      invoice({ due_date: '2026-06-14' }),
      new Date('2026-06-15T00:00:00Z')
    )
    expect(r.days_overdue).toBe(1)
  })
})

// ── summariseOverdue ──────────────────────────────────────────────────────────

describe('summariseOverdue', () => {
  it('aggregates totals and bucket counts correctly', () => {
    const invoices: OverdueInput[] = [
      invoice({ id: 'i1', due_date: '2026-06-14', amount: 5000 }), // 1-30: ₹5000
      invoice({ id: 'i2', due_date: '2026-05-01', amount: 8000 }), // 31-60: ₹8000
      invoice({ id: 'i3', due_date: '2026-12-31', amount: 3000 }), // not_due: ₹3000
      invoice({ id: 'i4', due_date: '2026-05-01', status: 'paid', amount: 4000 }), // not overdue
    ]

    const s = summariseOverdue(invoices, asOf)

    expect(s.count_overdue).toBe(2)
    expect(s.total_overdue).toBe(13000)
    expect(s.total_outstanding).toBe(16000) // includes not_due
    expect(s.by_bucket['1-30'].amount).toBe(5000)
    expect(s.by_bucket['31-60'].amount).toBe(8000)
    expect(s.by_bucket['not_due'].amount).toBe(3000)
  })

  it('empty array returns zero totals', () => {
    const s = summariseOverdue([], asOf)
    expect(s.total_overdue).toBe(0)
    expect(s.count_overdue).toBe(0)
  })
})
