/**
 * RLS Isolation Test
 * Proves that tenant A cannot read tenant B's data.
 *
 * Requires a running Supabase instance (local or remote).
 * Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY to run.
 * Automatically skipped in CI when these vars are absent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY)

describe.skipIf(!hasSupabase)('RLS: tenant isolation', () => {
  let admin: SupabaseClient
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  const emailA = `rls-test-a-${Date.now()}@test.coreops.local`
  const emailB = `rls-test-b-${Date.now()}@test.coreops.local`
  const password = 'Test1234!RLS'

  let businessAId: string
  let businessBId: string
  let customerAId: string
  let customerBId: string

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)
    clientA = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
    clientB = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)

    // Create two auth users via admin API
    const { data: userAData, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    })
    if (errA) throw new Error(`Create user A failed: ${errA.message}`)

    const { data: userBData, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    })
    if (errB) throw new Error(`Create user B failed: ${errB.message}`)

    // Sign in as A and B
    const { error: signAErr } = await clientA.auth.signInWithPassword({ email: emailA, password })
    if (signAErr) throw new Error(`Sign in A failed: ${signAErr.message}`)

    const { error: signBErr } = await clientB.auth.signInWithPassword({ email: emailB, password })
    if (signBErr) throw new Error(`Sign in B failed: ${signBErr.message}`)

    // Create a business for each user (using their own signed-in client)
    const { data: bizA, error: bizAErr } = await clientA
      .from('businesses')
      .insert({ owner_user_id: userAData.user.id, name: 'Business A (RLS Test)' })
      .select('id')
      .single()
    if (bizAErr) throw new Error(`Insert business A failed: ${bizAErr.message}`)
    businessAId = bizA.id

    const { data: bizB, error: bizBErr } = await clientB
      .from('businesses')
      .insert({ owner_user_id: userBData.user.id, name: 'Business B (RLS Test)' })
      .select('id')
      .single()
    if (bizBErr) throw new Error(`Insert business B failed: ${bizBErr.message}`)
    businessBId = bizB.id

    // Seed a customer + invoice for each business
    const { data: custA, error: custAErr } = await clientA
      .from('customers')
      .insert({ business_id: businessAId, name: 'Customer of A' })
      .select('id')
      .single()
    if (custAErr) throw new Error(`Insert customer A failed: ${custAErr.message}`)
    customerAId = custA.id

    const { data: custB, error: custBErr } = await clientB
      .from('customers')
      .insert({ business_id: businessBId, name: 'Customer of B' })
      .select('id')
      .single()
    if (custBErr) throw new Error(`Insert customer B failed: ${custBErr.message}`)
    customerBId = custB.id

    await clientA.from('invoices').insert({
      business_id: businessAId,
      customer_id: customerAId,
      invoice_number: 'RLS-A-001',
      amount: 50000,
      issue_date: '2026-05-01',
      due_date: '2026-05-31',
    })

    await clientB.from('invoices').insert({
      business_id: businessBId,
      customer_id: customerBId,
      invoice_number: 'RLS-B-001',
      amount: 75000,
      issue_date: '2026-05-01',
      due_date: '2026-05-31',
    })
  })

  afterAll(async () => {
    // Clean up test data via service role (bypasses RLS)
    await admin.from('invoices').delete().eq('business_id', businessAId)
    await admin.from('invoices').delete().eq('business_id', businessBId)
    await admin.from('customers').delete().eq('business_id', businessAId)
    await admin.from('customers').delete().eq('business_id', businessBId)
    await admin.from('businesses').delete().eq('id', businessAId)
    await admin.from('businesses').delete().eq('id', businessBId)
    await admin.auth.admin.deleteUser((await clientA.auth.getUser()).data.user!.id)
    await admin.auth.admin.deleteUser((await clientB.auth.getUser()).data.user!.id)
  })

  it('user A sees only their own invoices', async () => {
    const { data, error } = await clientA.from('invoices').select('invoice_number')
    expect(error).toBeNull()
    const numbers = data?.map((r) => r.invoice_number) ?? []
    expect(numbers).toContain('RLS-A-001')
    expect(numbers).not.toContain('RLS-B-001')
  })

  it('user B sees only their own invoices', async () => {
    const { data, error } = await clientB.from('invoices').select('invoice_number')
    expect(error).toBeNull()
    const numbers = data?.map((r) => r.invoice_number) ?? []
    expect(numbers).toContain('RLS-B-001')
    expect(numbers).not.toContain('RLS-A-001')
  })

  it('user A cannot read user B customers', async () => {
    const { data } = await clientA.from('customers').select('id').eq('id', customerBId)
    expect(data).toHaveLength(0)
  })

  it('user B cannot read user A customers', async () => {
    const { data } = await clientB.from('customers').select('id').eq('id', customerAId)
    expect(data).toHaveLength(0)
  })

  it('user A cannot directly query another business row', async () => {
    const { data } = await clientA.from('businesses').select('id').eq('id', businessBId)
    expect(data).toHaveLength(0)
  })
})
