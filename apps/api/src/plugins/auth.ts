// Auth plugin: verifies Supabase JWT, decorates request with businessId + per-request client.
// Every authenticated route calls `req.authenticate()` as a preHandler.
//
// Supabase signs access tokens with project-specific asymmetric keys (ES256, rotating,
// identified by `kid`) rather than a static HS256 secret, so verification must happen
// against the project's JWKS endpoint instead of a fixed SUPABASE_JWT_SECRET.
// supabase-js's `getClaims()` does this locally (fetches + caches the JWKS, verifies via
// WebCrypto) and is the SDK-blessed replacement for manual HS256 secret verification.

import { createClient } from '@supabase/supabase-js'
import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { UnauthorizedError } from './errors.js'

async function authPlugin(app: FastifyInstance) {
  // Decorate request so TypeScript knows these fields exist
  app.decorateRequest('businessId', '')
  app.decorateRequest('supabase', null as never)

  // Call this as a preHandler on every route that requires auth
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing Bearer token')

    const token = header.slice(7)

    // Per-request Supabase client carrying the user JWT — RLS enforced by Supabase
    const client = createClient(app.env.SUPABASE_URL, app.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    try {
      const { data: claims, error: claimsError } = await client.auth.getClaims(token)
      if (claimsError || !claims) throw claimsError ?? new Error('No claims returned')
    } catch {
      throw new UnauthorizedError('Invalid or expired token')
    }

    // Resolve business_id for this user
    const { data, error } = await client.from('businesses').select('id').maybeSingle()

    if (error) {
      req.log.error({ err: error }, 'failed to resolve business')
      throw new UnauthorizedError('Could not resolve business for this user')
    }

    if (!data) throw new UnauthorizedError('No business found for this user — please onboard first')

    req.businessId = data.id
    req.supabase = client

    req.log.info({ businessId: req.businessId }, 'authenticated')
  })
}

// Extend the FastifyInstance type so `app.authenticate` is known
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>
  }
}

export default fp(authPlugin, { name: 'auth' })
