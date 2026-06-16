import type { SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../env.js'

declare module 'fastify' {
  interface FastifyInstance {
    env: Env
    supabaseAdmin: SupabaseClient
  }

  interface FastifyRequest {
    // Set by the auth plugin after JWT verification
    businessId: string
    // Per-request client carrying the user's JWT (RLS enforced by Supabase)
    supabase: SupabaseClient
  }
}
