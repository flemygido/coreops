import { describe, it, expect } from 'vitest'
import { checkFollowUpDraft, GuardrailViolationError } from '../guardrails.js'
import type { FollowUpDraftInput } from '../types.js'

const input: FollowUpDraftInput = {
  customer_name: 'Sharma Traders',
  invoice_number: 'INV-1001',
  amount_outstanding: 25000,
  currency: 'INR',
  days_overdue: 14,
}

const validText = `Hi Sharma Traders, a friendly reminder that invoice INV-1001 for ₹25,000 is 14 days overdue. Please arrange payment at your earliest convenience.`

describe('checkFollowUpDraft', () => {
  it('passes a well-formed draft', () => {
    expect(() => checkFollowUpDraft(validText, input)).not.toThrow()
  })

  it('rejects an empty message', () => {
    expect(() => checkFollowUpDraft('   ', input)).toThrow(GuardrailViolationError)
  })

  it('rejects a message over the length cap', () => {
    expect(() => checkFollowUpDraft(validText.padEnd(400, '.'), input)).toThrow(
      GuardrailViolationError
    )
  })

  it('rejects a message containing a URL', () => {
    expect(() =>
      checkFollowUpDraft(`${validText} Pay now: https://pay.example.com/x`, input)
    ).toThrow(GuardrailViolationError)
  })

  it('rejects a message that omits the customer name', () => {
    expect(() => checkFollowUpDraft('Your invoice INV-1001 is overdue.', input)).toThrow(
      GuardrailViolationError
    )
  })

  it('rejects a message that omits the invoice number', () => {
    expect(() => checkFollowUpDraft('Hi Sharma Traders, your invoice is overdue.', input)).toThrow(
      GuardrailViolationError
    )
  })
})
