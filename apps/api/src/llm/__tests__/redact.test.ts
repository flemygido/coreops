import { describe, it, expect } from 'vitest'
import { toFollowUpDraftInput } from '../redact.js'
import type { ReceivablesStateItem } from '../../services/receivables-state.js'

const item: ReceivablesStateItem = {
  invoice_id: 'inv-1',
  invoice_number: 'INV-1001',
  customer_id: 'cust-1',
  customer_name: 'Sharma Traders',
  customer_phone: '+919876543210',
  amount: 50000,
  amount_outstanding: 25000,
  days_overdue: 14,
  age_bucket: '1-30',
}

describe('toFollowUpDraftInput', () => {
  it('only includes allowlisted fields', () => {
    const input = toFollowUpDraftInput(item)
    expect(input).toEqual({
      customer_name: 'Sharma Traders',
      invoice_number: 'INV-1001',
      amount_outstanding: 25000,
      currency: 'INR',
      days_overdue: 14,
    })
  })

  it('never includes phone, customer_id, or invoice_id', () => {
    const input = toFollowUpDraftInput(item)
    const serialized = JSON.stringify(input)
    expect(serialized).not.toContain(item.customer_phone)
    expect(serialized).not.toContain(item.customer_id)
    expect(serialized).not.toContain(item.invoice_id)
  })
})
