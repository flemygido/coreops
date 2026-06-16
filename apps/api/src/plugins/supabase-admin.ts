// Service-role Supabase client — bypasses RLS. Use only for:
// - Writing audit_log entries from system jobs
// - Seeding / admin operations in tests
// NEVER expose this client to user-facing routes.

import { createClient } from '@supabase/supabase-js'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'

async function supabaseAdminPlugin(app: FastifyInstance) {
  const admin = createClient(app.env.SUPABASE_URL, app.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  app.decorate('supabaseAdmin', admin)
}

export default fp(supabaseAdminPlugin, { name: 'supabase-admin' })
