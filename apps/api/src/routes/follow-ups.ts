import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { NotFoundError } from '../plugins/errors.js'

// Note (Phase 4): this schema previously listed columns (channel, message_text,
// resolved_at) and status values (pending/responded) that don't exist on the real
// follow_ups table — see supabase/migrations/20260615000001_schema.sql. Never caught
// because the only test exercising this route checked the 401-without-auth path,
// same blind spot as the Phase 2 auth bug (see PROGRESS.md). Fixed to match the DB.
const FollowUpSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  business_id: Type.String({ format: 'uuid' }),
  briefing_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  invoice_id: Type.String({ format: 'uuid' }),
  customer_id: Type.String({ format: 'uuid' }),
  drafted_text: Type.String(),
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('approved'),
    Type.Literal('sent'),
    Type.Literal('failed'),
    Type.Literal('skipped'),
  ]),
  approved_at: Type.Union([Type.String(), Type.Null()]),
  sent_at: Type.Union([Type.String(), Type.Null()]),
  whatsapp_message_id: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
})

const ListQuery = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('draft'),
      Type.Literal('approved'),
      Type.Literal('sent'),
      Type.Literal('failed'),
      Type.Literal('skipped'),
    ])
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
})

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

const PatchStatusBody = Type.Object({
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('approved'),
    Type.Literal('sent'),
    Type.Literal('failed'),
    Type.Literal('skipped'),
  ]),
})

export const followUpsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  app.get(
    '/follow-ups',
    {
      ...auth,
      schema: {
        querystring: ListQuery,
        response: { 200: Type.Array(FollowUpSchema) },
      },
    },
    async (req) => {
      const {
        status,
        limit = 50,
        offset = 0,
      } = req.query as {
        status?: string
        limit?: number
        offset?: number
      }

      let query = req.supabase
        .from('follow_ups')
        .select('*')
        .eq('business_id', req.businessId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    }
  )

  app.patch(
    '/follow-ups/:id/status',
    {
      ...auth,
      schema: {
        params: IdParam,
        body: PatchStatusBody,
        response: { 200: FollowUpSchema },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string }
      const { status } = req.body as { status: string }

      const approved_at = status === 'approved' ? new Date().toISOString() : undefined
      const sent_at = status === 'sent' ? new Date().toISOString() : undefined

      const { data, error } = await req.supabase
        .from('follow_ups')
        .update({ status, ...(approved_at && { approved_at }), ...(sent_at && { sent_at }) })
        .eq('id', id)
        .eq('business_id', req.businessId)
        .select()
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new NotFoundError('FollowUp', id)
      return data
    }
  )
}
