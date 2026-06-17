import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { parseModelRanking } from '../llm/model-ranking.js'
import { getLlmClientForRanking } from '../llm/registry.js'
import { draftFollowUps } from '../services/draft-follow-ups.js'
import { sendFollowUp } from '../services/send-follow-up.js'
import { NotFoundError, ValidationError } from '../plugins/errors.js'

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

const WorkflowRunResponse = Type.Object({
  drafted: Type.Integer(),
  skipped_already_pending: Type.Integer(),
  failed: Type.Integer(),
  errors: Type.Array(
    Type.Object({
      invoice_id: Type.String(),
      message: Type.String(),
    })
  ),
})

const SendFollowUpResponse = Type.Object({
  ok: Type.Boolean(),
  whatsapp_message_id: Type.Union([Type.String(), Type.Null()]),
  message: Type.String(),
})

export const workflowRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  // POST /v1/workflow/run — draft follow-ups for all overdue invoices that
  // don't already have an active one. Idempotent: safe to re-run.
  // Tighter rate limit: max 5 calls per 5 minutes per IP (LLM cost protection).
  app.post(
    '/workflow/run',
    {
      ...auth,
      config: {
        rateLimit: { max: 5, timeWindow: '5 minutes' },
      },
      schema: { response: { 200: WorkflowRunResponse } },
    },
    async (req) => {
      const ranking = parseModelRanking(app.env.LLM_RANKING_FOLLOW_UP_DRAFT)
      const llm = getLlmClientForRanking(ranking, {
        anthropic: app.env.ANTHROPIC_API_KEY,
        openai: app.env.OPENAI_API_KEY,
      })

      // Use admin client for cost logging (llm_usage_log requires service-role write)
      const adminSupabase = createClient(app.env.SUPABASE_URL, app.env.SUPABASE_SERVICE_ROLE_KEY)

      const result = await draftFollowUps(
        req.supabase,
        adminSupabase,
        req.businessId,
        llm,
        app.env.LLM_DAILY_BUDGET_USD
      )
      return result
    }
  )

  // POST /v1/follow-ups/:id/send — send one approved follow-up via the
  // business's configured messaging connector.
  app.post(
    '/follow-ups/:id/send',
    {
      ...auth,
      schema: {
        params: IdParam,
        response: { 200: SendFollowUpResponse },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string }

      // Validate the follow-up exists and belongs to this business before sending
      const { data: followUp, error } = await req.supabase
        .from('follow_ups')
        .select('id, status')
        .eq('id', id)
        .eq('business_id', req.businessId)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!followUp) throw new NotFoundError('FollowUp', id)

      const fu = followUp as { id: string; status: string }
      if (fu.status !== 'approved') {
        throw new ValidationError(
          `Follow-up must be approved before sending (current: ${fu.status})`
        )
      }

      const result = await sendFollowUp(req.supabase, req.businessId, id)
      return result
    }
  )
}
