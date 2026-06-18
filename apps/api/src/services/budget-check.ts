// Daily LLM budget guard. Checked before every draft run so cost surprises
// can't compound across multiple invoices in a single workflow call.
// Budget is per-business per UTC calendar day; resets at midnight UTC.

import type { SupabaseClient } from '@supabase/supabase-js'
import { AppError } from '../plugins/errors.js'

export async function checkDailyBudget(
  supabase: SupabaseClient,
  businessId: string,
  limitUsd: number
): Promise<void> {
  const todayUtc = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('llm_usage_log')
    .select('cost_usd')
    .eq('business_id', businessId)
    .gte('created_at', `${todayUtc}T00:00:00Z`)

  if (error) throw new Error(`Budget check failed: ${error.message}`)

  const spentToday = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0)

  if (spentToday >= limitUsd) {
    throw new AppError(
      429,
      'BUDGET_EXCEEDED',
      `Daily LLM budget of $${limitUsd.toFixed(2)} reached ($${spentToday.toFixed(4)} spent today). Resets at midnight UTC.`
    )
  }
}
