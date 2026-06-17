// DPDP Routes — India's Digital Personal Data Protection Rules 2025.
// Provides data principal rights: erasure and access summary.
//
// DELETE /v1/customers/:id/erase
//   Hard-erases a customer and all their data (cascade: invoices, follow_ups,
//   payments, consent_records). Records an erasure_requests tombstone so the
//   erasure is auditable even after the customer row is gone.
//
// GET /v1/dpdp/summary
//   Returns aggregate counts of stored personal data for this business —
//   the owner can share this with a data principal on request.

import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'
import { NotFoundError } from '../plugins/errors.js'

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) })

const ErasureResponse = Type.Object({
  erased: Type.Boolean(),
  customer_id: Type.String(),
  tables_erased: Type.Array(Type.String()),
})

const SummaryResponse = Type.Object({
  business_id: Type.String(),
  counts: Type.Object({
    customers: Type.Integer(),
    invoices: Type.Integer(),
    follow_ups: Type.Integer(),
    consent_records: Type.Integer(),
    audit_log_entries: Type.Integer(),
  }),
  as_of: Type.String(),
})

export const dpdpRoutes: FastifyPluginAsync = async (app) => {
  const auth = { preHandler: [app.authenticate] }

  // DELETE /v1/customers/:id/erase — DPDP Right to Erasure
  app.delete(
    '/customers/:id/erase',
    {
      ...auth,
      schema: {
        params: IdParam,
        response: { 200: ErasureResponse },
      },
    },
    async (req) => {
      const { id } = req.params as { id: string }

      // Verify customer belongs to this business (RLS-scoped client)
      const { data: customer, error: findErr } = await req.supabase
        .from('customers')
        .select('id, name')
        .eq('id', id)
        .eq('business_id', req.businessId)
        .maybeSingle()

      if (findErr) throw new Error(findErr.message)
      if (!customer) throw new NotFoundError('Customer', id)

      // Delete — cascades to invoices, payments, follow_ups, consent_records
      const { error: delErr } = await req.supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .eq('business_id', req.businessId)

      if (delErr) throw new Error(delErr.message)

      // Record erasure tombstone (uses RLS-scoped client — authenticated user
      // has insert on erasure_requests via grants migration)
      const tablesErased = ['customers', 'invoices', 'payments', 'follow_ups', 'consent_records']
      const { error: tombErr } = await req.supabase.from('erasure_requests').insert({
        business_id: req.businessId,
        customer_id: id,
        requested_by: (await req.supabase.auth.getUser()).data.user?.id ?? null,
        tables_erased: tablesErased,
      })

      if (tombErr) {
        // Erasure completed but tombstone failed — log and continue, don't undo erasure
        req.log.error({ err: tombErr, customerId: id }, 'Erasure tombstone insert failed')
      }

      return { erased: true, customer_id: id, tables_erased: tablesErased }
    }
  )

  // GET /v1/dpdp/summary — aggregate stored data counts for this business
  app.get(
    '/dpdp/summary',
    {
      ...auth,
      schema: { response: { 200: SummaryResponse } },
    },
    async (req) => {
      const [customers, invoices, followUps, consent, auditLog] = await Promise.all([
        req.supabase
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', req.businessId),
        req.supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', req.businessId),
        req.supabase
          .from('follow_ups')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', req.businessId),
        req.supabase
          .from('consent_records')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', req.businessId),
        req.supabase
          .from('audit_log')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', req.businessId),
      ])

      return {
        business_id: req.businessId,
        counts: {
          customers: customers.count ?? 0,
          invoices: invoices.count ?? 0,
          follow_ups: followUps.count ?? 0,
          consent_records: consent.count ?? 0,
          audit_log_entries: auditLog.count ?? 0,
        },
        as_of: new Date().toISOString(),
      }
    }
  )
}
