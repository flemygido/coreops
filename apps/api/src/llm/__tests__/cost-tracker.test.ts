import { describe, it, expect, vi } from 'vitest'
import { calculateCostUsd, logLlmUsage } from '../cost-tracker.js'
import type { SupabaseClient } from '@supabase/supabase-js'

describe('calculateCostUsd', () => {
  it('calculates Haiku 4.5 cost correctly', () => {
    // 1000 input tokens @ $1/M + 500 output tokens @ $5/M
    const cost = calculateCostUsd('claude-haiku-4-5-20251001', 1000, 500)
    expect(cost).toBeCloseTo(0.001 + 0.0025, 6)
  })

  it('calculates zero cost for zero tokens', () => {
    expect(calculateCostUsd('claude-haiku-4-5-20251001', 0, 0)).toBe(0)
  })

  it('throws for an unknown model', () => {
    expect(() => calculateCostUsd('claude-made-up-model', 100, 100)).toThrow(/Unknown model/)
  })
})

describe('logLlmUsage', () => {
  it('inserts a row with the calculated cost', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    await logLlmUsage(supabase, {
      businessId: 'biz-1',
      purpose: 'follow_up_draft',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 500,
    })

    expect(supabase.from).toHaveBeenCalledWith('llm_usage_log')
    expect(insert).toHaveBeenCalledWith({
      business_id: 'biz-1',
      purpose: 'follow_up_draft',
      model: 'claude-haiku-4-5-20251001',
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.001 + 0.0025,
    })
  })

  it('throws if the insert fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'db down' } })
    const supabase = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    await expect(
      logLlmUsage(supabase, {
        businessId: 'biz-1',
        purpose: 'follow_up_draft',
        model: 'claude-haiku-4-5-20251001',
        inputTokens: 10,
        outputTokens: 10,
      })
    ).rejects.toThrow(/db down/)
  })
})
