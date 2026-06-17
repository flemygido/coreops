import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApp } from '../app.js'
import type { Env } from '../env.js'

const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3001,
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
}

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof createApp>>

  beforeAll(async () => {
    app = await createApp(testEnv)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.version).toBe('0.1.0')
    expect(typeof body.uptime).toBe('number')
  })

  it('does not require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).not.toBe(401)
  })
})
