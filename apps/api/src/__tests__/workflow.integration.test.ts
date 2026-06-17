/**
 * Workflow Integration Tests
 * Proves POST /v1/workflow/run and POST /v1/follow-ups/:id/send work
 * end-to-end against a real local Supabase + mock LLM (no real API calls).
 *
 * Automatically skipped without SUPABASE_URL + LLM keys.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createApp } from '../app.js'
import { loadEnv } from '../env.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY)

// Stub the LLM so the workflow test doesn't need a real API key
vi.mock('../llm/follow-up-draft.js', () => ({
  draftFollowUp: vi
    .fn()
    .mockResolvedValue(
      'Hi Test Customer, invoice INV-WF-1 for ₹5,000 is 10 days overdue. Kindly arrange payment.'
    ),
}))

describe.skipIf(!hasSupabase)('Workflow: end-to-end with mocked LLM', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let admin: SupabaseClient
  let userClient: SupabaseClient
  let accessToken: string
  let businessId: string
  let customerId: string
  let invoiceId: string
  let followUpId: string

  const email = `workflow-test-${Date.now()}@test.coreops.local`
  const password = 'Test1234!Workflow'

  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = 'a'.repeat(64)
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
      .insert({ owner_user_id: userData.user.id, name: 'Workflow Test Business' })
      .select('id')
      .single()
    if (bizErr) throw new Error(`Insert business failed: ${bizErr.message}`)
    businessId = biz.id

    const { data: customer, error: custErr } = await userClient
      .from('customers')
      .insert({ business_id: businessId, name: 'Test Customer', phone: '+919876543210' })
      .select('id')
      .single()
    if (custErr) throw new Error(`Insert customer failed: ${custErr.message}`)
    customerId = customer.id

    // Overdue invoice: due 10 days ago
    const dueDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const { data: invoice, error: invErr } = await userClient
      .from('invoices')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        invoice_number: 'INV-WF-1',
        amount: 5000,
        amount_paid: 0,
        issue_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        due_date: dueDate,
        status: 'open',
      })
      .select('id')
      .single()
    if (invErr) throw new Error(`Insert invoice failed: ${invErr.message}`)
    invoiceId = invoice.id
  })

  afterAll(async () => {
    await admin.from('follow_ups').delete().eq('business_id', businessId)
    await admin.from('invoices').delete().eq('business_id', businessId)
    await admin.from('customers').delete().eq('business_id', businessId)
    await admin.from('businesses').delete().eq('id', businessId)
    await admin.auth.admin.deleteUser((await userClient.auth.getUser()).data.user!.id)
    await app.close()
  })

  it('POST /v1/workflow/run — drafts a follow-up for the overdue invoice', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/workflow/run',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.drafted).toBe(1)
    expect(body.skipped_already_pending).toBe(0)
    expect(body.failed).toBe(0)

    // Confirm the follow-up row was created
    const { data } = await userClient
      .from('follow_ups')
      .select('id, drafted_text, status')
      .eq('business_id', businessId)
      .eq('invoice_id', invoiceId)
      .single()
    expect(data).not.toBeNull()
    expect(data!.status).toBe('draft')
    expect(data!.drafted_text).toContain('INV-WF-1')
    followUpId = data!.id
  })

  it('POST /v1/workflow/run — idempotent: re-run skips existing draft', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/workflow/run',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.drafted).toBe(0)
    expect(body.skipped_already_pending).toBe(1)
  })

  it('POST /v1/follow-ups/:id/send — rejects a draft (must be approved first)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/follow-ups/${followUpId}/send`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /v1/follow-ups/:id/send — sends an approved follow-up', async () => {
    // Approve it first
    await app.inject({
      method: 'PATCH',
      url: `/v1/follow-ups/${followUpId}/status`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'approved' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/v1/follow-ups/${followUpId}/send`,
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.whatsapp_message_id).toBeTruthy()

    // Confirm status updated to sent
    const { data } = await userClient
      .from('follow_ups')
      .select('status, sent_at')
      .eq('id', followUpId)
      .single()
    expect(data!.status).toBe('sent')
    expect(data!.sent_at).not.toBeNull()
  })

  it('POST /v1/follow-ups/:id/send — 404 on unknown follow-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/follow-ups/00000000-0000-0000-0000-000000000000/send',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /v1/workflow/run — returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/workflow/run' })
    expect(res.statusCode).toBe(401)
  })
})
