/**
 * DPDP Integration Tests
 * Proves DELETE /v1/customers/:id/erase and GET /v1/dpdp/summary work
 * end-to-end against live local Supabase.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createApp } from '../app.js'
import { loadEnv } from '../env.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY)

describe.skipIf(!hasSupabase)('DPDP endpoints', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let admin: SupabaseClient
  let userClient: SupabaseClient
  let accessToken: string
  let businessId: string
  let customerId: string

  const email = `dpdp-test-${Date.now()}@test.coreops.local`
  const password = 'Test1234!DPDP'

  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = 'a'.repeat(64)
    if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy'
    }
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

    const { data: signIn, error: signInErr } = await userClient.auth.signInWithPassword({
      email,
      password,
    })
    if (signInErr) throw new Error(`Sign in failed: ${signInErr.message}`)
    accessToken = signIn.session!.access_token

    const { data: biz, error: bizErr } = await userClient
      .from('businesses')
      .insert({ owner_user_id: userData.user.id, name: 'DPDP Test Business' })
      .select('id')
      .single()
    if (bizErr) throw new Error(`Insert business failed: ${bizErr.message}`)
    businessId = biz.id

    const { data: customer, error: custErr } = await userClient
      .from('customers')
      .insert({ business_id: businessId, name: 'Erase Me', phone: '+919999999999' })
      .select('id')
      .single()
    if (custErr) throw new Error(`Insert customer failed: ${custErr.message}`)
    customerId = customer.id
  })

  afterAll(async () => {
    await admin.from('businesses').delete().eq('id', businessId)
    await admin.auth.admin.deleteUser((await userClient.auth.getUser()).data.user!.id)
    await app.close()
  })

  it('GET /v1/dpdp/summary — returns data counts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/dpdp/summary',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.business_id).toBe(businessId)
    expect(body.counts.customers).toBe(1)
    expect(body.counts.invoices).toBe(0)
    expect(typeof body.as_of).toBe('string')
  })

  it('DELETE /v1/customers/:id/erase — erases customer and records tombstone', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/customers/${customerId}/erase`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.erased).toBe(true)
    expect(body.customer_id).toBe(customerId)
    expect(body.tables_erased).toContain('customers')

    // Confirm customer is gone
    const { data } = await userClient
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .maybeSingle()
    expect(data).toBeNull()

    // Confirm erasure tombstone was written
    const { data: tombstone } = await userClient
      .from('erasure_requests')
      .select('customer_id, tables_erased')
      .eq('customer_id', customerId)
      .maybeSingle()
    expect(tombstone).not.toBeNull()
    expect(tombstone!.customer_id).toBe(customerId)
  })

  it('DELETE /v1/customers/:id/erase — 404 on unknown customer', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/customers/00000000-0000-0000-0000-000000000000/erase',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET /v1/dpdp/summary — 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/dpdp/summary' })
    expect(res.statusCode).toBe(401)
  })
})
