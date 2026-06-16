import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { NotFoundError } from '../plugins/errors.js'

const InvoiceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  business_id: Type.String({ format: 'uuid' }),
  customer_id: Type.String({ format: 'uuid' }),
  external_id: Type.Union([Type.String(), Type.Null()]),
  invoice_number: Type.String(),
  amount: Type.Number(),
  amount_paid: Type.Number(),
  currency: Type.String(),
  issue_date: Type.String(),
  due_date: Type.String(),
  status: Type.Union([
    Type.Literal('open'),
    Type.Literal('partial'),
    Type.Literal('paid'),
    Type.Literal('void'),
    Type.Literal('written_off'),
  ]),
  notes: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
})

const ListQuery = Type.Object({
  status: Type.Optional(
    Type.Union([
      Type.Literal('open'),
      Type.Literal('partial'),
      Type.Literal('paid'),
      Type.Literal('void'),
      Type.Literal('written_off'),
    ])
  ),
  customer_id: Type.Optional(Type.String({ format: 'uuid' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
})

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const invoicesRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  app.get(
    '/invoices',
    {
      ...auth,
      schema: {
        querystring: ListQuery,
        response: { 200: Type.Array(InvoiceSchema) },
      },
    },
    async (req) => {
      const {
        status,
        customer_id,
        limit = 50,
        offset = 0,
      } = req.query as {
        status?: string
        customer_id?: string
        limit?: number
        offset?: number
      }

      let query = req.supabase
        .from('invoices')
        .select('*')
        .eq('business_id', req.businessId)
        .order('due_date', { ascending: true })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq('status', status)
      if (customer_id) query = query.eq('customer_id', customer_id)

      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    }
  )

  app.get(
    '/invoices/:id',
    {
      ...auth,
      schema: {
        params: IdParam,
        response: { 200: InvoiceSchema },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string }

      const { data, error } = await req.supabase
        .from('invoices')
        .select('*')
        .eq('id', id)
        .eq('business_id', req.businessId)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new NotFoundError('Invoice', id)
      return data
    }
  )
}
