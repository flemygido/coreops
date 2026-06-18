// Data retention: purge follow-ups that are past the configured retention window.
// Only terminal statuses (sent, skipped, failed) are eligible — draft and approved
// follow-ups are in-flight and must not be deleted by the retention job.
//
// DPDP Rules 2025: "data not needed for stated purpose must be deleted."
// Once a follow-up is sent/skipped/failed, its content is no longer needed for
// the receivables recovery workflow. The audit_log trigger already captured the
// event, so compliance evidence survives deletion of the follow-up row itself.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RetentionResult {
  deleted: number
  error: string | null
}

export async function purgeOldFollowUps(
  supabase: SupabaseClient,
  businessId: string,
  retentionDays: number
): Promise<RetentionResult> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('follow_ups')
    .delete()
    .eq('business_id', businessId)
    .in('status', ['sent', 'skipped', 'failed'])
    .lt('created_at', cutoff)
    .select('id')

  if (error) return { deleted: 0, error: error.message }
  return { deleted: data?.length ?? 0, error: null }
}
