/**
 * Connected Accounts Integration Test
 * Proves the full path: API route -> encrypt credentials -> store in DB (RLS-scoped)
 * -> list/test-connection -> decrypt -> mock connector -> delete.
 *
 * Requires a running Supabase instance (local or remote).
 * Automatically skipped in CI when SUPABASE_URL etc. are absent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createApp } from '../app.js'
import { loadEnv } from '../env.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY)

describe.skipIf(!hasSupabase)('Connected Accounts: full route path', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let admin: SupabaseClient
  let userClient: SupabaseClient
  let accessToken: string
  let businessId: string
  let accountId: string

  const email = `connectors-test-${Date.now()}@test.coreops.local`
  const password = 'Test1234!Connectors'

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
    app = await createApp(loadEnv())
    await app.ready()

    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
    userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)

    const { data: userData, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (createErr) throw new Error(`Create user failed: ${createErr.message}`)

    const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({
      email,
      password,
    })
    if (signInErr) throw new Error(`Sign in failed: ${signInErr.message}`)
    accessToken = signInData.session!.access_token

    const { data: biz, error: bizErr } = await userClient
      .from('businesses')
      .insert({ owner_user_id: userData.user.id, name: 'Connectors Test Business' })
      .select('id')
      .single()
    if (bizErr) throw new Error(`Insert business failed: ${bizErr.message}`)
    businessId = biz.id
  })

  afterAll(async () => {
    await admin.from('connected_accounts').delete().eq('business_id', businessId)
    await admin.from('businesses').delete().eq('id', businessId)
    await admin.auth.admin.deleteUser((await userClient.auth.getUser()).data.user!.id)
    await app.close()
  })

  it('creates a connected account without leaking credentials in the response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/connected-accounts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        provider: 'zoho_books',
        credentials: { access_token: 'fake-token', organization_id: 'fake-org' },
      },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.provider).toBe('zoho_books')
    expect(body.credentials_encrypted).toBeUndefined()
    accountId = body.id
  })

  it('rejects a duplicate provider for the same business (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/connected-accounts',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        provider: 'zoho_books',
        credentials: { access_token: 'another-token', organization_id: 'another-org' },
      },
    })
    expect(res.statusCode).toBe(409)
  })

  it('lists connected accounts for the business', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connected-accounts',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.some((a: { id: string }) => a.id === accountId)).toBe(true)
  })

  it('runs testConnection through the decrypt -> mock connector path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/connected-accounts/${accountId}/test`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('deletes the connected account', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/connected-accounts/${accountId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(204)
  })
})
