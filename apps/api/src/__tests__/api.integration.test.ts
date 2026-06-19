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
  ENCRYPTION_KEY: 'a'.repeat(64),
  ANTHROPIC_API_KEY: undefined,
  OPENAI_API_KEY: undefined,
  LLM_RANKING_FOLLOW_UP_DRAFT: 'openai:gpt-5-nano,anthropic:claude-haiku-4-5-20251001',
  WORKFLOW_CRON: '30 1 * * *',
  DASHBOARD_ORIGIN: 'http://localhost:3001',
  LLM_DAILY_BUDGET_USD: 1.0,
  RETENTION_DAYS: 365,
  WHATSAPP_ENABLED: false,
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
    ['GET', '/v1/invoices', undefined],
    ['GET', '/v1/customers', undefined],
    ['GET', '/v1/briefings', undefined],
    ['GET', '/v1/follow-ups', undefined],
    ['GET', '/v1/receivables/state', undefined],
    ['GET', '/v1/connected-accounts', undefined],
    [
      'POST',
      '/v1/connected-accounts',
      { provider: 'zoho_books', credentials: { access_token: 'x' } },
    ],
    ['DELETE', '/v1/connected-accounts/00000000-0000-0000-0000-000000000000', undefined],
    ['POST', '/v1/connected-accounts/00000000-0000-0000-0000-000000000000/test', undefined],
  ] as const

  for (const [method, url, payload] of protectedRoutes) {
    it(`${method} ${url} requires auth (401 without token)`, async () => {
      const res = await app.inject({ method, url, payload })
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
