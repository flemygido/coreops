// Daily receivables workflow cron job.
// Runs on WORKFLOW_CRON (default 01:30 UTC = 07:00 IST).
// For each active business:
//   1. Drafts follow-ups for newly overdue invoices (LLM)
//   2. Reports the result to the server log
// Sending approved follow-ups is owner-triggered (PATCH approve → POST send).
//
// croner chosen over node-cron — see ADR-0004 for rationale.

import { Cron } from 'croner'
import type { FastifyInstance } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { parseModelRanking } from '../llm/model-ranking.js'
import { getLlmClientForRanking } from '../llm/registry.js'
import { draftFollowUps } from '../services/draft-follow-ups.js'
import { syncBusiness } from '../services/sync.js'

export function startDailyWorkflow(app: FastifyInstance): Cron {
  const { env } = app

  return new Cron(env.WORKFLOW_CRON, { timezone: 'UTC', protect: true }, async () => {
    app.log.info({ job: 'daily-workflow' }, 'Starting daily receivables workflow')

    try {
      // Build the LLM client from configured ranking
      const ranking = parseModelRanking(env.LLM_RANKING_FOLLOW_UP_DRAFT)
      const llm = getLlmClientForRanking(ranking, {
        anthropic: env.ANTHROPIC_API_KEY,
        openai: env.OPENAI_API_KEY,
      })

      // Service-role client to list businesses; per-business RLS client for data access
      const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      const { data: businesses, error } = await admin.from('businesses').select('id')
      if (error) throw new Error(`Failed to list businesses: ${error.message}`)

      for (const biz of businesses ?? []) {
        // Sync live accounting data into Postgres before drafting.
        // Returns 'skipped' if no accounting connector is configured (safe no-op).
        const syncResult = await syncBusiness(admin, biz.id as string)
        app.log.info(
          { job: 'daily-workflow', businessId: biz.id, sync: syncResult },
          'Sync complete'
        )

        // Use a per-business anon client scoped via RLS isn't possible server-side
        // without a user token. Use admin client for reads, which is safe because
        // this job only runs server-side with no user context.
        const result = await draftFollowUps(
          admin,
          admin,
          biz.id as string,
          llm,
          env.LLM_DAILY_BUDGET_USD
        )
        app.log.info({ job: 'daily-workflow', businessId: biz.id, ...result }, 'Workflow complete')
      }
    } catch (err) {
      app.log.error({ job: 'daily-workflow', err }, 'Daily workflow failed')
    }
  })
}
