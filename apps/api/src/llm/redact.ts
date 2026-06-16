// Privacy boundary enforcement (CLAUDE.md: "PII redacted before leaving the
// private boundary"). The LLM only drafts message *text* — it never needs a
// phone number, email, internal customer ID, or free-text notes field to do
// that, so those never get assembled into a prompt in the first place.
//
// Allowlisting fields is deliberate over regex/entity-detection PII scrubbing:
// the input here is structured DB rows we already chose the shape of (not
// freeform third-party text), so the safer and simpler control is "only these
// fields may ever reach the prompt," not "find and strip bad-looking patterns."

import type { ReceivablesStateItem } from '../services/receivables-state.js'
import type { FollowUpDraftInput } from './types.js'

export function toFollowUpDraftInput(item: ReceivablesStateItem): FollowUpDraftInput {
  return {
    customer_name: item.customer_name,
    invoice_number: item.invoice_number,
    amount_outstanding: item.amount_outstanding,
    // Hardcoded: v1 targets Indian SMBs only and receivables-state.ts doesn't
    // currently select invoices.currency. Revisit if/when multi-currency matters.
    currency: 'INR',
    days_overdue: item.days_overdue,
  }
}
