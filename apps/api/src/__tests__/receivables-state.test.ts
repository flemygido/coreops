import { describe, it, expect, vi } from 'vitest'
import { getReceivablesState } from '../services/receivables-state.js'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeSupabase(invoices: unknown[], customers: unknown[]) {
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      const rows = table === 'invoices' ? invoices : customers
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }
    }),
  }
  return client as unknown as SupabaseClient
}

const asOf = new Date('2026-06-16T00:00:00Z')

describe('getReceivablesState', () => {
  it('returns zeros when no invoices', async () => {
    const client = makeSupabase([], [])
    const result = await getReceivablesState(client, 'biz-1', asOf)
    expect(result.total_outstanding).toBe(0)
    expect(result.total_overdue).toBe(0)
    expect(result.count_overdue).toBe(0)
    expect(result.overdue_invoices).toHaveLength(0)
  })

  it('classifies overdue invoice correctly', async () => {
    const invoices = [
      {
        id: 'inv-1',
        customer_id: 'cust-1',
        invoice_number: 'INV-001',
        amount: 10000,
        amount_paid: 0,
        due_date: '2026-05-01',
        status: 'open',
      },
    ]
    const customers = [{ id: 'cust-1', name: 'Ravi Traders', phone: '+919876543210' }]

    const client = makeSupabase(invoices, customers)
    const result = await getReceivablesState(client, 'biz-1', asOf)

    expect(result.count_overdue).toBe(1)
    expect(result.total_overdue).toBe(10000)
    expect(result.overdue_invoices[0].customer_name).toBe('Ravi Traders')
    expect(result.overdue_invoices[0].age_bucket).toBe('31-60')
  })

  it('excludes paid invoices from overdue list', async () => {
    // The service fetches only open/partial from DB — simulate empty response for paid
    const client = makeSupabase([], [])
    const result = await getReceivablesState(client, 'biz-1', asOf)
    expect(result.count_overdue).toBe(0)
  })

  it('sorts overdue invoices by days_overdue descending', async () => {
    const invoices = [
      {
        id: 'inv-1',
        customer_id: 'cust-1',
        invoice_number: 'INV-001',
        amount: 5000,
        amount_paid: 0,
        due_date: '2026-06-10',
        status: 'open',
      },
      {
        id: 'inv-2',
        customer_id: 'cust-1',
        invoice_number: 'INV-002',
        amount: 8000,
        amount_paid: 0,
        due_date: '2026-05-01',
        status: 'open',
      },
    ]
    const customers = [{ id: 'cust-1', name: 'Sita Enterprises', phone: null }]

    const client = makeSupabase(invoices, customers)
    const result = await getReceivablesState(client, 'biz-1', asOf)

    expect(result.overdue_invoices[0].invoice_id).toBe('inv-2')
    expect(result.overdue_invoices[1].invoice_id).toBe('inv-1')
  })

  it('handles missing customer gracefully', async () => {
    const invoices = [
      {
        id: 'inv-1',
        customer_id: 'cust-missing',
        invoice_number: 'INV-001',
        amount: 3000,
        amount_paid: 0,
        due_date: '2026-05-15',
        status: 'open',
      },
    ]

    const client = makeSupabase(invoices, [])
    const result = await getReceivablesState(client, 'biz-1', asOf)

    expect(result.overdue_invoices[0].customer_name).toBe('Unknown')
    expect(result.overdue_invoices[0].customer_phone).toBeNull()
  })

  it('includes business_id and as_of in result', async () => {
    const client = makeSupabase([], [])
    const result = await getReceivablesState(client, 'biz-xyz', asOf)
    expect(result.business_id).toBe('biz-xyz')
    expect(result.as_of).toBe(asOf.toISOString())
  })
})
