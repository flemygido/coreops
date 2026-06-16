/**
 * Follow-ups Integration Test
 * Proves GET /v1/follow-ups and PATCH /v1/follow-ups/:id/status work against
 * the real follow_ups table columns (drafted_text, approved_at, status enum
 * draft/approved/sent/failed/skipped) — see PROGRESS.md Process Note (Phase 4)
 * for the bug this replaces: the route previously referenced columns/status
 * values that don't exist in the schema, caught only because Phase 4 needed
 * this table to actually work for LLM-drafted follow-ups.
 *
 * Requires a running Supabase instance. Skipped in CI when SUPABASE_URL etc. are absent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createApp } from '../app.js'
import { loadEnv } from '../env.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY)

describe.skipIf(!hasSupabase)('Follow-ups: full route path', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let admin: SupabaseClient
  let userClient: SupabaseClient
  let accessToken: string
  let businessId: string
  let customerId: string
  let invoiceId: string
  let followUpId: string

  const email = `followups-test-${Date.now()}@test.coreops.local`
  const password = 'Test1234!FollowUps'

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
      .insert({ owner_user_id: userData.user.id, name: 'Follow-ups Test Business' })
      .select('id')
      .single()
    if (bizErr) throw new Error(`Insert business failed: ${bizErr.message}`)
    businessId = biz.id

    const { data: customer, error: custErr } = await userClient
      .from('customers')
      .insert({ business_id: businessId, name: 'Test Customer' })
      .select('id')
      .single()
    if (custErr) throw new Error(`Insert customer failed: ${custErr.message}`)
    customerId = customer.id

    const { data: invoice, error: invErr } = await userClient
      .from('invoices')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        invoice_number: 'INV-TEST-1',
        amount: 10000,
        amount_paid: 0,
        issue_date: '2026-05-01',
        due_date: '2026-05-15',
        status: 'open',
      })
      .select('id')
      .single()
    if (invErr) throw new Error(`Insert invoice failed: ${invErr.message}`)
    invoiceId = invoice.id

    const { data: followUp, error: fuErr } = await userClient
      .from('follow_ups')
      .insert({
        business_id: businessId,
        invoice_id: invoiceId,
        customer_id: customerId,
        drafted_text: 'Hi Test Customer, invoice INV-TEST-1 for ₹10,000 is overdue.',
      })
      .select('id')
      .single()
    if (fuErr) throw new Error(`Insert follow_up failed: ${fuErr.message}`)
    followUpId = followUp.id
  })

  afterAll(async () => {
    await admin.from('follow_ups').delete().eq('business_id', businessId)
    await admin.from('invoices').delete().eq('business_id', businessId)
    await admin.from('customers').delete().eq('business_id', businessId)
    await admin.from('businesses').delete().eq('id', businessId)
    await admin.auth.admin.deleteUser((await userClient.auth.getUser()).data.user!.id)
    await app.close()
  })

  it('lists follow-ups with the real schema fields (drafted_text, status: draft)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/follow-ups',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const found = body.find((f: { id: string }) => f.id === followUpId)
    expect(found).toBeDefined()
    expect(found.drafted_text).toContain('INV-TEST-1')
    expect(found.status).toBe('draft')
  })

  it('filters by status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/follow-ups?status=draft',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().some((f: { id: string }) => f.id === followUpId)).toBe(true)
  })

  it('approves a follow-up and sets approved_at', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/follow-ups/${followUpId}/status`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'approved' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('approved')
    expect(body.approved_at).not.toBeNull()
  })

  it('marks a follow-up as sent and sets sent_at', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/follow-ups/${followUpId}/status`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'sent' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('sent')
    expect(body.sent_at).not.toBeNull()
  })

  it('404s when patching a non-existent follow-up', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/follow-ups/00000000-0000-0000-0000-000000000000/status',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'approved' },
    })
    expect(res.statusCode).toBe(404)
  })
})
