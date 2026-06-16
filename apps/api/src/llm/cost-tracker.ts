// Deterministic cost calculation + logging for every LLM call (CLAUDE.md Hard
// Rule #6: this is arithmetic, not LLM-generated, even though it's about LLM
// usage). Token counts come straight off the Anthropic Messages API response.

import type { SupabaseClient } from '@supabase/supabase-js'

// USD per million tokens. Source: Anthropic pricing, June 2026 — update when
// models change. Deliberately explicit per-model rather than a formula, so a
// stale price is a visible one-line diff, not a silent miscalculation.
const PRICING_PER_MILLION_TOKENS_USD: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
}

export function calculateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_PER_MILLION_TOKENS_USD[model]
  if (!pricing) {
    throw new Error(
      `Unknown model for cost calculation: ${model} — add it to PRICING_PER_MILLION_TOKENS_USD`
    )
  }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
}

export interface LogLlmUsageParams {
  businessId: string
  purpose: 'follow_up_draft' | 'briefing_summary'
  model: string
  inputTokens: number
  outputTokens: number
}

export async function logLlmUsage(
  supabase: SupabaseClient,
  params: LogLlmUsageParams
): Promise<void> {
  const cost_usd = calculateCostUsd(params.model, params.inputTokens, params.outputTokens)

  const { error } = await supabase.from('llm_usage_log').insert({
    business_id: params.businessId,
    purpose: params.purpose,
    model: params.model,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    cost_usd,
  })

  if (error) throw new Error(`Failed to log LLM usage: ${error.message}`)
}
