import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { NotFoundError, ConflictError } from '../plugins/errors.js'

const BriefingSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  business_id: Type.String({ format: 'uuid' }),
  generated_at: Type.String(),
  sent_at: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([Type.Literal('draft'), Type.Literal('sent'), Type.Literal('failed')]),
  summary_text: Type.Union([Type.String(), Type.Null()]),
  content_json: Type.Record(Type.String(), Type.Unknown()),
  total_overdue: Type.Union([Type.Number(), Type.Null()]),
  invoice_count: Type.Union([Type.Integer(), Type.Null()]),
})

const ListQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 30 })),
})

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const briefingsRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  app.get(
    '/briefings',
    {
      ...auth,
      schema: {
        querystring: ListQuery,
        response: { 200: Type.Array(BriefingSchema) },
      },
    },
    async (req) => {
      const { limit = 30 } = req.query as { limit?: number }

      const { data, error } = await req.supabase
        .from('briefings')
        .select('*')
        .eq('business_id', req.businessId)
        .order('generated_at', { ascending: false })
        .limit(limit)

      if (error) throw new Error(error.message)
      return data ?? []
    }
  )

  app.get(
    '/briefings/:id',
    {
      ...auth,
      schema: {
        params: IdParam,
        response: { 200: BriefingSchema },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string }

      const { data, error } = await req.supabase
        .from('briefings')
        .select('*')
        .eq('id', id)
        .eq('business_id', req.businessId)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new NotFoundError('Briefing', id)
      return data
    }
  )

  // POST /briefings — create a draft briefing record.
  // Idempotent: only one draft briefing per business per UTC day allowed.
  // Phase 4 will fill in summary_text and content_json.
  app.post(
    '/briefings',
    {
      ...auth,
      schema: {
        response: { 201: BriefingSchema },
      },
    },
    async (req, reply) => {
      const todayUTC = new Date().toISOString().split('T')[0]

      // Check for existing briefing today (natural idempotency)
      const { data: existing } = await req.supabase
        .from('briefings')
        .select('*')
        .eq('business_id', req.businessId)
        .gte('generated_at', `${todayUTC}T00:00:00Z`)
        .lt('generated_at', `${todayUTC}T23:59:59Z`)
        .maybeSingle()

      if (existing) throw new ConflictError('A briefing already exists for today')

      const { data, error } = await req.supabase
        .from('briefings')
        .insert({ business_id: req.businessId, status: 'draft' })
        .select()
        .single()

      if (error) throw new Error(error.message)
      return reply.status(201).send(data)
    }
  )
}
