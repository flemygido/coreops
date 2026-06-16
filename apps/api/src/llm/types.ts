// Provider-abstracted LLM client contract — mirrors the connectors pattern
// (see ../connectors/types.ts): nothing outside this directory should know
// it's talking to Anthropic specifically. Swapping providers is a registry
// change, not a call-site change (CLAUDE.md stack rationale: "prevents lock-in").

export interface FollowUpDraftInput {
  customer_name: string
  invoice_number: string
  amount_outstanding: number
  currency: string
  days_overdue: number
}

export interface FollowUpDraftResult {
  message_text: string
  model: string
  input_tokens: number
  output_tokens: number
}

export interface LlmClient {
  readonly provider: string
  readonly model: string
  generateFollowUpDraft(input: FollowUpDraftInput): Promise<FollowUpDraftResult>
}
