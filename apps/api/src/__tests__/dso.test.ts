import { describe, it, expect } from 'vitest'
import { calcDsoDays, calcRupeesRecovered } from '@coreops/shared'

describe('calcDsoDays', () => {
  it('returns null when credit sales are zero (undefined, not infinite)', () => {
    expect(calcDsoDays(50000, 0)).toBeNull()
  })

  it('returns 0 when accounts receivable is zero', () => {
    expect(calcDsoDays(0, 100000)).toBe(0)
  })

  it('calculates a normal DSO correctly', () => {
    // (50000 / 100000) * 30 = 15.0
    expect(calcDsoDays(50000, 100000)).toBe(15)
  })

  it('rounds to one decimal place', () => {
    // (10000 / 90000) * 30 = 3.333... → 3.3
    expect(calcDsoDays(10000, 90000)).toBe(3.3)
  })

  it('returns high DSO when AR far exceeds 30-day sales (slow payers)', () => {
    // (200000 / 50000) * 30 = 120.0
    expect(calcDsoDays(200000, 50000)).toBe(120)
  })

  it('handles equal AR and credit sales (DSO = 30)', () => {
    expect(calcDsoDays(75000, 75000)).toBe(30)
  })

  it('accepts a custom window in days', () => {
    // (50000 / 100000) * 90 = 45.0
    expect(calcDsoDays(50000, 100000, 90)).toBe(45)
  })

  it('returns DSO < 30 when AR is less than 30-day sales (healthy)', () => {
    // (25000 / 100000) * 30 = 7.5
    expect(calcDsoDays(25000, 100000)).toBe(7.5)
  })
})

describe('calcRupeesRecovered', () => {
  it('returns 0 for an empty array', () => {
    expect(calcRupeesRecovered([])).toBe(0)
  })

  it('returns 0 when no invoices are fully paid', () => {
    const invoices = [
      { amount: 50000, amount_paid: 0 },
      { amount: 25000, amount_paid: 10000 },
    ]
    expect(calcRupeesRecovered(invoices)).toBe(0)
  })

  it('counts a single fully paid invoice', () => {
    const invoices = [{ amount: 50000, amount_paid: 50000 }]
    expect(calcRupeesRecovered(invoices)).toBe(50000)
  })

  it('excludes partially paid invoices', () => {
    const invoices = [
      { amount: 50000, amount_paid: 50000 }, // fully paid
      { amount: 20000, amount_paid: 10000 }, // partially paid — excluded
      { amount: 30000, amount_paid: 0 }, // unpaid — excluded
    ]
    expect(calcRupeesRecovered(invoices)).toBe(50000)
  })

  it('sums multiple fully paid invoices', () => {
    const invoices = [
      { amount: 50000, amount_paid: 50000 },
      { amount: 30000, amount_paid: 30000 },
      { amount: 20000, amount_paid: 10000 }, // partial — excluded
    ]
    expect(calcRupeesRecovered(invoices)).toBe(80000)
  })

  it('handles string amounts from Postgres numeric type', () => {
    // Supabase returns Postgres numeric columns as strings
    const invoices = [
      { amount: '50000.00', amount_paid: '50000.00' },
      { amount: '25000.00', amount_paid: '12500.00' },
    ]
    expect(calcRupeesRecovered(invoices)).toBe(50000)
  })

  it('counts overpaid invoices as recovered (amount_paid > amount)', () => {
    // Edge case: rounding or pre-payment means amount_paid slightly exceeds amount
    const invoices = [{ amount: 50000, amount_paid: 50001 }]
    expect(calcRupeesRecovered(invoices)).toBe(50000)
  })
})
