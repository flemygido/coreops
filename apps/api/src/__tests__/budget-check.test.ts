import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkDailyBudget } from '../services/budget-check.js'
import { AppError } from '../plugins/errors.js'

function makeSupabase(rows: { cost_usd: number }[], error: string | null = null) {
  const result = { data: error ? null : rows, error: error ? { message: error } : null }
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient
}

describe('checkDailyBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-17T10:00:00Z'))
  })

  it('passes when no spend today', async () => {
    const supabase = makeSupabase([])
    await expect(checkDailyBudget(supabase, 'biz-1', 1.0)).resolves.toBeUndefined()
  })

  it('passes when spend is under limit', async () => {
    const supabase = makeSupabase([{ cost_usd: 0.3 }, { cost_usd: 0.4 }])
    await expect(checkDailyBudget(supabase, 'biz-1', 1.0)).resolves.toBeUndefined()
  })

  it('throws BUDGET_EXCEEDED when spend equals limit', async () => {
    const supabase = makeSupabase([{ cost_usd: 0.5 }, { cost_usd: 0.5 }])
    await expect(checkDailyBudget(supabase, 'biz-1', 1.0)).rejects.toThrow(AppError)
    await expect(checkDailyBudget(supabase, 'biz-1', 1.0)).rejects.toMatchObject({
      statusCode: 429,
      code: 'BUDGET_EXCEEDED',
    })
  })

  it('throws BUDGET_EXCEEDED when spend exceeds limit', async () => {
    const supabase = makeSupabase([{ cost_usd: 1.5 }])
    await expect(checkDailyBudget(supabase, 'biz-1', 1.0)).rejects.toThrow(AppError)
  })

  it('throws on DB error', async () => {
    const supabase = makeSupabase([], 'connection refused')
    await expect(checkDailyBudget(supabase, 'biz-1', 1.0)).rejects.toThrow('Budget check failed')
  })
})
