// Output-side checks on a generated follow-up draft. The owner reviews every
// draft before it's sent (no auto-send in v1), so this isn't the only safety
// net — but a draft that fails these checks is wrong/unsafe enough that it
// shouldn't even reach the owner's approval queue.

import type { FollowUpDraftInput } from './types.js'

// WhatsApp's hard cap is 4096 chars, but a follow-up nudge has no business
// being that long — anything past this reads as the model going off-script.
const MAX_LENGTH = 320
const URL_PATTERN = /https?:\/\/|www\./i

export class GuardrailViolationError extends Error {
  constructor(reason: string) {
    super(`Follow-up draft failed guardrails: ${reason}`)
    this.name = 'GuardrailViolationError'
  }
}

export function checkFollowUpDraft(text: string, input: FollowUpDraftInput): void {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    throw new GuardrailViolationError('empty message')
  }
  if (trimmed.length > MAX_LENGTH) {
    throw new GuardrailViolationError(`exceeds ${MAX_LENGTH} characters (${trimmed.length})`)
  }
  if (URL_PATTERN.test(trimmed)) {
    throw new GuardrailViolationError(
      'contains a URL — never inject links into owner-sent messages'
    )
  }
  if (!trimmed.includes(input.customer_name)) {
    throw new GuardrailViolationError('does not mention the customer by name')
  }
  if (!trimmed.includes(input.invoice_number)) {
    throw new GuardrailViolationError('does not reference the invoice number')
  }
}
