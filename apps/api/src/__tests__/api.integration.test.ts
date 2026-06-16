/**
 * API Authorization Integration Test
 * Proves that authenticated routes reject unauthenticated requests (401)
 * and that the health endpoint is always open.
 *
 * Uses Fastify's inject — no real Supabase needed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApp } from '../app.js'
import type { Env } from '../env.js'

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3002,
  LOG_LEVEL: 'silent',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_JWT_SECRET: 'super-secret-jwt-token-with-at-least-32-characters-long',
  ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('API auth enforcement', () => {
  let app: Awaited<ReturnType<typeof createApp>>

  beforeAll(async () => {
    app = await createApp(testEnv)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health is open (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })

  const protectedRoutes = [
    ['GET', '/v1/invoices'],
    ['GET', '/v1/customers'],
    ['GET', '/v1/briefings'],
    ['GET', '/v1/follow-ups'],
    ['GET', '/v1/receivables/state'],
  ] as const

  for (const [method, url] of protectedRoutes) {
    it(`${method} ${url} requires auth (401 without token)`, async () => {
      const res = await app.inject({ method, url })
      expect(res.statusCode).toBe(401)
    })
  }

  it('returns 401 with malformed Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/invoices',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    })
    expect(res.statusCode).toBe(401)
  })
})
