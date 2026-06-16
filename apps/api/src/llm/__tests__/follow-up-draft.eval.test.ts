/**
 * Eval suite for follow-up draft generation — runs against the REAL LLM API
 * resolved from LLM_RANKING_FOLLOW_UP_DRAFT (see model-ranking.ts), so it
 * proves something a mocked test can't: that whichever model is actually
 * configured produces drafts that pass guardrails and stay on-topic. Skipped
 * when no candidate's API key is present, same gating pattern as the
 * Supabase-only integration tests — this is NOT mocked out as a substitute
 * for a real run; if this never executes, it has not been verified, and the
 * report says so explicitly.
 */
import { describe, it, expect, vi } from 'vitest'
import { getLlmClient } from '../registry.js'
import { parseModelRanking, resolveModelCandidate } from '../model-ranking.js'
import { draftFollowUp } from '../follow-up-draft.js'
import { checkFollowUpDraft } from '../guardrails.js'
import { toFollowUpDraftInput } from '../redact.js'
import type { ReceivablesStateItem } from '../../services/receivables-state.js'
import type { SupabaseClient } from '@supabase/supabase-js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const hasAnyKey = Boolean(ANTHROPIC_API_KEY || OPENAI_API_KEY)

const DEFAULT_RANKING =
  'openai:gpt-5-nano,openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001,anthropic:claude-sonnet-4-6'
const ranking = parseModelRanking(process.env.LLM_RANKING_FOLLOW_UP_DRAFT ?? DEFAULT_RANKING)

const goldenSet: ReceivablesStateItem[] = [
  {
    invoice_id: 'inv-1',
    invoice_number: 'INV-1001',
    customer_id: 'cust-1',
    customer_name: 'Sharma Traders',
    customer_phone: '+919876543210',
    amount: 50000,
    amount_outstanding: 50000,
    days_overdue: 5,
    age_bucket: '1-30',
  },
  {
    invoice_id: 'inv-2',
    invoice_number: 'INV-2042',
    customer_id: 'cust-2',
    customer_name: 'Patel Hardware & Co',
    customer_phone: '+919812345678',
    amount: 125000,
    amount_outstanding: 75000,
    days_overdue: 47,
    age_bucket: '31-60',
  },
  {
    invoice_id: 'inv-3',
    invoice_number: 'INV-3199',
    customer_id: 'cust-3',
    customer_name: 'Singh Enterprises',
    customer_phone: '+919900112233',
    amount: 8000,
    amount_outstanding: 8000,
    days_overdue: 95,
    age_bucket: '90+',
  },
]

describe.skipIf(!hasAnyKey)('Follow-up draft eval (real LLM API)', () => {
  // describe.skipIf still executes this body to register tests even when
  // skipped — resolveModelCandidate() throws without a key, so bail out
  // before calling it rather than relying on the skip alone.
  if (!hasAnyKey) return

  const candidate = resolveModelCandidate(ranking, {
    anthropic: ANTHROPIC_API_KEY,
    openai: OPENAI_API_KEY,
  })
  const apiKey = candidate.provider === 'anthropic' ? ANTHROPIC_API_KEY! : OPENAI_API_KEY!
  const client = getLlmClient(candidate.provider, apiKey, candidate.model)

  it(`resolved to ${candidate.provider}:${candidate.model} from the configured keys`, () => {
    expect(client.provider).toBe(candidate.provider)
    expect(client.model).toBe(candidate.model)
  })

  for (const item of goldenSet) {
    it(`drafts a valid follow-up for ${item.customer_name} (${item.days_overdue}d overdue)`, async () => {
      const input = toFollowUpDraftInput(item)
      const result = await client.generateFollowUpDraft(input)

      expect(() => checkFollowUpDraft(result.message_text, input)).not.toThrow()
      expect(result.input_tokens).toBeGreaterThan(0)
      expect(result.output_tokens).toBeGreaterThan(0)
    }, 30000)
  }

  it('draftFollowUp() end-to-end: real LLM call + cost logged via the supplied client', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    const text = await draftFollowUp(client, supabase, 'biz-eval', goldenSet[0]!)

    expect(text).toContain('Sharma Traders')
    expect(text).toContain('INV-1001')
    expect(supabase.from).toHaveBeenCalledWith('llm_usage_log')
    expect(insert).toHaveBeenCalledTimes(1)
  }, 30000)
})

describe.skipIf(hasAnyKey)('Follow-up draft eval (skipped notice)', () => {
  it('was skipped — no ANTHROPIC_API_KEY or OPENAI_API_KEY set', () => {
    expect(hasAnyKey).toBe(false)
  })
})
