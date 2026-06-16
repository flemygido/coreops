import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { NotFoundError } from '../plugins/errors.js'

const CustomerSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  business_id: Type.String({ format: 'uuid' }),
  external_id: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  phone: Type.Union([Type.String(), Type.Null()]),
  email: Type.Union([Type.String(), Type.Null()]),
  credit_limit: Type.Union([Type.Number(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
})

const ListQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 100 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
})

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

export const customersRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  app.get(
    '/customers',
    {
      ...auth,
      schema: {
        querystring: ListQuery,
        response: { 200: Type.Array(CustomerSchema) },
      },
    },
    async (req) => {
      const { limit = 100, offset = 0 } = req.query as { limit?: number; offset?: number }

      const { data, error } = await req.supabase
        .from('customers')
        .select('*')
        .eq('business_id', req.businessId)
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(error.message)
      return data ?? []
    }
  )

  app.get(
    '/customers/:id',
    {
      ...auth,
      schema: {
        params: IdParam,
        response: { 200: CustomerSchema },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string }

      const { data, error } = await req.supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .eq('business_id', req.businessId)
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new NotFoundError('Customer', id)
      return data
    }
  )
}
