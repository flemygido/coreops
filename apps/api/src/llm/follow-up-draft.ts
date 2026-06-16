// Orchestrates one follow-up draft: minimize the data sent to the model,
// generate, validate the output, and log what it cost. This is the only
// entry point Phase 5's workflow/routes should call — it never touches the
// database itself beyond the usage log, mirroring receivables-state.ts being
// a pure assembly function the caller decides what to do with.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReceivablesStateItem } from '../services/receivables-state.js'
import { toFollowUpDraftInput } from './redact.js'
import { checkFollowUpDraft } from './guardrails.js'
import { logLlmUsage } from './cost-tracker.js'
import type { LlmClient } from './types.js'

export async function draftFollowUp(
  llm: LlmClient,
  supabase: SupabaseClient,
  businessId: string,
  invoice: ReceivablesStateItem
): Promise<string> {
  const input = toFollowUpDraftInput(invoice)
  const result = await llm.generateFollowUpDraft(input)

  checkFollowUpDraft(result.message_text, input)

  await logLlmUsage(supabase, {
    businessId,
    purpose: 'follow_up_draft',
    model: result.model,
    inputTokens: result.input_tokens,
    outputTokens: result.output_tokens,
  })

  return result.message_text
}
