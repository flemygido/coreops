import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { getReceivablesState } from '../services/receivables-state.js'

const BucketSchema = Type.Object({
  count: Type.Integer(),
  total: Type.Number(),
})

const ReceivablesStateItem = Type.Object({
  invoice_id: Type.String({ format: 'uuid' }),
  invoice_number: Type.String(),
  customer_id: Type.String({ format: 'uuid' }),
  customer_name: Type.String(),
  customer_phone: Type.Union([Type.String(), Type.Null()]),
  amount: Type.Number(),
  amount_outstanding: Type.Number(),
  days_overdue: Type.Integer(),
  age_bucket: Type.String(),
})

const ReceivablesStateResponse = Type.Object({
  as_of: Type.String(),
  business_id: Type.String({ format: 'uuid' }),
  total_outstanding: Type.Number(),
  total_overdue: Type.Number(),
  count_overdue: Type.Integer(),
  by_bucket: Type.Object({
    not_due: BucketSchema,
    current: BucketSchema,
    '1-30': BucketSchema,
    '31-60': BucketSchema,
    '61-90': BucketSchema,
    '90+': BucketSchema,
  }),
  overdue_invoices: Type.Array(ReceivablesStateItem),
})

export const receivablesRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  app.get(
    '/receivables/state',
    {
      ...auth,
      schema: {
        response: { 200: ReceivablesStateResponse },
      },
    },
    async (req) => {
      return getReceivablesState(req.supabase, req.businessId)
    }
  )
}
