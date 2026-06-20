// Unit tests for syncBusiness() — mocked connector + supabase.
// Does NOT hit the real DB or real Zoho. The live-data behaviour is covered
// by sync-real.integration.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingConnector } from '../../connectors/types.js'

// ── Module mocks (must be declared before any dynamic imports) ────────────────

vi.mock('../../lib/crypto.js', () => ({
  decrypt: vi.fn().mockReturnValue(
    JSON.stringify({
      client_id: 'test-id',
      client_secret: 'test-secret',
      refresh_token: 'test-rt',
      organization_id: 'org-1',
    })
  ),
}))

vi.mock('../../connectors/registry.js', () => ({
  isAccountingProvider: vi.fn().mockReturnValue(true),
  getAccountingConnector: vi.fn(),
}))

import { syncBusiness } from '../sync.js'
import { getAccountingConnector } from '../../connectors/registry.js'

// ── Mock builder helpers ──────────────────────────────────────────────────────

// Creates a single chainable Supabase query builder that resolves to `result`
// at the terminal (.maybeSingle / .single / .upsert / .update / direct await).
function chain(result: { data?: unknown; error?: unknown | null }) {
  const res = { data: result.data ?? null, error: result.error ?? null }
  const c: Record<string, unknown> = {}
  c['select'] = vi.fn().mockReturnValue(c)
  c['eq'] = vi.fn().mockReturnValue(c)
  c['in'] = vi.fn().mockReturnValue(c)
  c['insert'] = vi.fn().mockReturnValue(c)
  c['update'] = vi.fn().mockReturnValue(c)
  c['upsert'] = vi.fn().mockResolvedValue(res)
  c['maybeSingle'] = vi.fn().mockResolvedValue(res)
  c['single'] = vi.fn().mockResolvedValue(res)
  // Make the chain thenable so `await from(...).update(...).eq(...)` works
  c['then'] = (resolve: (v: typeof res) => unknown) => Promise.resolve(res).then(resolve)
  return c
}

// Builds a mock SupabaseClient where each table's calls return predetermined results.
// `tableQueues[table]` is a FIFO queue of chain() results consumed per from() call.
function makeMockSupabase(tableQueues: Record<string, ReturnType<typeof chain>[]>): SupabaseClient {
  const callCounters: Record<string, number> = {}
  return {
    from: vi.fn((table: string) => {
      callCounters[table] = (callCounters[table] ?? 0) + 1
      const queue = tableQueues[table] ?? []
      // Use the queued response for this call, or fall back to a null-result chain
      return queue[callCounters[table] - 1] ?? chain({ data: null, error: null })
    }),
  } as unknown as SupabaseClient
}

// A fully-passing mock connector
function makeMockConnector(): AccountingConnector {
  return {
    provider: 'zoho_books' as const,
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    fetchCustomers: vi.fn().mockResolvedValue([
      { external_id: 'C1', name: 'Ramesh Traders', phone: '+919876543210', email: null },
      { external_id: 'C2', name: 'Patel Wholesale', phone: null, email: null },
    ]),
    fetchInvoices: vi.fn().mockResolvedValue([
      {
        external_id: 'INV-1',
        customer_external_id: 'C1',
        invoice_number: 'INV-000001',
        amount: 72000,
        amount_paid: 0,
        currency: 'INR',
        issue_date: '2026-04-01',
        due_date: '2026-05-12',
        status: 'open' as const,
      },
    ]),
    fetchPayments: vi.fn().mockResolvedValue([]),
  }
}

// Standard connected_account row returned by the DB query
const mockAccount = { id: 'acct-uuid', provider: 'zoho_books', credentials_encrypted: 'enc' }
const mockRunRow = { id: 'run-uuid' }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncBusiness()', () => {
  describe('no connected account', () => {
    it('returns status:skipped when no active accounting account exists', async () => {
      const db = makeMockSupabase({
        connected_accounts: [chain({ data: null, error: null })],
      })

      const result = await syncBusiness(db, 'biz-1')

      expect(result.status).toBe('skipped')
      expect(result.provider).toBeNull()
      expect(result.customers_synced).toBe(0)
      expect(result.invoices_synced).toBe(0)
      expect(result.payments_synced).toBe(0)
    })

    it('makes no writes to any table when skipped', async () => {
      const db = makeMockSupabase({
        connected_accounts: [chain({ data: null, error: null })],
      })
      const fromSpy = db.from as ReturnType<typeof vi.fn>

      await syncBusiness(db, 'biz-1')

      // Only connected_accounts was queried; no insert/upsert/update calls
      const calledTables = fromSpy.mock.calls.map((c: string[]) => c[0])
      expect(calledTables).not.toContain('sync_runs')
      expect(calledTables).not.toContain('customers')
      expect(calledTables).not.toContain('invoices')
    })
  })

  describe('full success', () => {
    it('returns status:success with correct counts', async () => {
      vi.mocked(getAccountingConnector).mockReturnValue(makeMockConnector())

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }), // initial lookup
          chain({ data: null, error: null }), // last_synced_at update
        ],
        sync_runs: [
          chain({ data: mockRunRow, error: null }), // insert
          chain({ data: null, error: null }), // update
        ],
        customers: [
          chain({ data: null, error: null }), // upsert
          chain({
            // select for id resolution
            data: [
              { id: 'cust-int-1', external_id: 'C1' },
              { id: 'cust-int-2', external_id: 'C2' },
            ],
            error: null,
          }),
        ],
        invoices: [
          chain({ data: null, error: null }), // upsert
          chain({ data: [{ id: 'inv-int-1', external_id: 'INV-1' }], error: null }), // select
        ],
        payments: [chain({ data: null, error: null })],
      })

      const result = await syncBusiness(db, 'biz-1')

      expect(result.status).toBe('success')
      expect(result.provider).toBe('zoho_books')
      expect(result.customers_synced).toBe(2)
      expect(result.invoices_synced).toBe(1)
      expect(result.payments_synced).toBe(0)
      expect(result.error_count).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('calls all three connector fetch methods', async () => {
      const connector = makeMockConnector()
      vi.mocked(getAccountingConnector).mockReturnValue(connector)

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [chain({ data: mockRunRow, error: null }), chain({ data: null, error: null })],
        customers: [
          chain({ data: null, error: null }),
          chain({ data: [{ id: 'c1', external_id: 'C1' }], error: null }),
        ],
        invoices: [chain({ data: null, error: null }), chain({ data: [], error: null })],
        payments: [chain({ data: null, error: null })],
      })

      await syncBusiness(db, 'biz-1')

      expect(connector.fetchCustomers).toHaveBeenCalledOnce()
      expect(connector.fetchInvoices).toHaveBeenCalledOnce()
      expect(connector.fetchPayments).toHaveBeenCalledOnce()
    })

    it('passes connectedAccountId and supabase to getAccountingConnector for token persist', async () => {
      vi.mocked(getAccountingConnector).mockReturnValue(makeMockConnector())

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [chain({ data: mockRunRow, error: null }), chain({ data: null, error: null })],
        customers: [chain({ data: null, error: null }), chain({ data: [], error: null })],
        invoices: [chain({ data: null, error: null }), chain({ data: [], error: null })],
        payments: [chain({ data: null, error: null })],
      })

      await syncBusiness(db, 'biz-1')

      expect(getAccountingConnector).toHaveBeenCalledWith(
        'zoho_books',
        expect.any(Object),
        expect.objectContaining({ supabase: db, connectedAccountId: 'acct-uuid' })
      )
    })
  })

  describe('partial and failed states', () => {
    it('returns status:failed and logs error when customer fetch throws', async () => {
      const connector = makeMockConnector()
      ;(connector.fetchCustomers as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Zoho API unreachable')
      )
      vi.mocked(getAccountingConnector).mockReturnValue(connector)

      const db = makeMockSupabase({
        connected_accounts: [chain({ data: mockAccount, error: null })],
        sync_runs: [chain({ data: mockRunRow, error: null }), chain({ data: null, error: null })],
      })

      const result = await syncBusiness(db, 'biz-1')

      expect(result.status).toBe('failed')
      expect(result.error_count).toBe(1)
      expect(result.errors[0]).toMatch(/customers.*Zoho API unreachable/)
      // Invoice and payment fetch must NOT have been attempted
      expect(connector.fetchInvoices).not.toHaveBeenCalled()
      expect(connector.fetchPayments).not.toHaveBeenCalled()
    })

    it('returns status:partial when customers succeed but invoice fetch throws', async () => {
      const connector = makeMockConnector()
      ;(connector.fetchInvoices as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('invoice endpoint 503')
      )
      vi.mocked(getAccountingConnector).mockReturnValue(connector)

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [chain({ data: mockRunRow, error: null }), chain({ data: null, error: null })],
        customers: [
          chain({ data: null, error: null }),
          chain({ data: [{ id: 'c1', external_id: 'C1' }], error: null }),
        ],
        invoices: [],
        payments: [chain({ data: null, error: null })],
      })

      const result = await syncBusiness(db, 'biz-1')

      expect(result.status).toBe('partial')
      expect(result.customers_synced).toBe(2) // customers worked
      expect(result.invoices_synced).toBe(0) // invoices failed
      expect(result.error_count).toBe(1)
      expect(result.errors[0]).toMatch(/invoices.*invoice endpoint 503/)
    })

    it('returns status:partial when invoices succeed but payment fetch throws', async () => {
      const connector = makeMockConnector()
      ;(connector.fetchPayments as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('payments 429')
      )
      vi.mocked(getAccountingConnector).mockReturnValue(connector)

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [chain({ data: mockRunRow, error: null }), chain({ data: null, error: null })],
        customers: [
          chain({ data: null, error: null }),
          chain({ data: [{ id: 'c1', external_id: 'C1' }], error: null }),
        ],
        invoices: [
          chain({ data: null, error: null }),
          chain({ data: [{ id: 'i1', external_id: 'INV-1' }], error: null }),
        ],
        payments: [],
      })

      const result = await syncBusiness(db, 'biz-1')

      expect(result.status).toBe('partial')
      expect(result.customers_synced).toBe(2)
      expect(result.invoices_synced).toBe(1)
      expect(result.payments_synced).toBe(0)
      expect(result.errors[0]).toMatch(/payments.*payments 429/)
    })
  })

  describe('tenant isolation', () => {
    it('scopes all upserts to the supplied businessId (not a cross-tenant write)', async () => {
      const connector = makeMockConnector()
      vi.mocked(getAccountingConnector).mockReturnValue(connector)

      // Capture what business_id is passed to each upsert
      const upsertedBusinessIds: string[] = []
      const capturingChain = (result: ReturnType<typeof chain>) => {
        const c = result
        const originalUpsert = c['upsert'] as (...args: unknown[]) => unknown
        ;(c['upsert'] as ReturnType<typeof vi.fn>).mockImplementation(
          (rows: Array<{ business_id: string }>) => {
            upsertedBusinessIds.push(...rows.map((r) => r.business_id))
            return originalUpsert(rows)
          }
        )
        return c
      }

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [chain({ data: mockRunRow, error: null }), chain({ data: null, error: null })],
        customers: [
          capturingChain(chain({ data: null, error: null })),
          chain({
            data: [
              { id: 'c1', external_id: 'C1' },
              { id: 'c2', external_id: 'C2' },
            ],
            error: null,
          }),
        ],
        invoices: [
          capturingChain(chain({ data: null, error: null })),
          chain({ data: [{ id: 'i1', external_id: 'INV-1' }], error: null }),
        ],
        payments: [chain({ data: null, error: null })],
      })

      await syncBusiness(db, 'biz-A')

      // Every upserted row must belong to 'biz-A', never 'biz-B' or anything else
      expect(upsertedBusinessIds.every((id) => id === 'biz-A')).toBe(true)
      expect(upsertedBusinessIds.length).toBeGreaterThan(0)
    })
  })

  describe('sync_runs logging', () => {
    it('creates a sync_run and finalises it with status and counts', async () => {
      vi.mocked(getAccountingConnector).mockReturnValue(makeMockConnector())

      let insertedRun: Record<string, unknown> | null = null
      let updatedRun: Record<string, unknown> | null = null

      const syncRunsInsertChain = chain({ data: mockRunRow, error: null })
      ;(syncRunsInsertChain['insert'] as ReturnType<typeof vi.fn>).mockImplementation(
        (row: Record<string, unknown>) => {
          insertedRun = row
          return syncRunsInsertChain
        }
      )

      const syncRunsUpdateChain = chain({ data: null, error: null })
      ;(syncRunsUpdateChain['update'] as ReturnType<typeof vi.fn>).mockImplementation(
        (updates: Record<string, unknown>) => {
          updatedRun = updates
          return syncRunsUpdateChain
        }
      )

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [syncRunsInsertChain, syncRunsUpdateChain],
        customers: [
          chain({ data: null, error: null }),
          chain({
            data: [
              { id: 'c1', external_id: 'C1' },
              { id: 'c2', external_id: 'C2' },
            ],
            error: null,
          }),
        ],
        invoices: [
          chain({ data: null, error: null }),
          chain({ data: [{ id: 'i1', external_id: 'INV-1' }], error: null }),
        ],
        payments: [chain({ data: null, error: null })],
      })

      await syncBusiness(db, 'biz-1')

      expect(insertedRun).toMatchObject({
        business_id: 'biz-1',
        provider: 'zoho_books',
        status: 'running',
      })
      expect(updatedRun).toMatchObject({
        status: 'success',
        customers_synced: 2,
        invoices_synced: 1,
        payments_synced: 0,
        error_count: 0,
      })
      expect(updatedRun!['finished_at']).toBeTruthy()
    })

    it('logs error_detail in sync_run when partial', async () => {
      const connector = makeMockConnector()
      ;(connector.fetchInvoices as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'))
      vi.mocked(getAccountingConnector).mockReturnValue(connector)

      let updatedRun: Record<string, unknown> | null = null
      const syncRunsUpdateChain = chain({ data: null, error: null })
      ;(syncRunsUpdateChain['update'] as ReturnType<typeof vi.fn>).mockImplementation(
        (updates: Record<string, unknown>) => {
          updatedRun = updates
          return syncRunsUpdateChain
        }
      )

      const db = makeMockSupabase({
        connected_accounts: [
          chain({ data: mockAccount, error: null }),
          chain({ data: null, error: null }),
        ],
        sync_runs: [chain({ data: mockRunRow, error: null }), syncRunsUpdateChain],
        customers: [
          chain({ data: null, error: null }),
          chain({ data: [{ id: 'c1', external_id: 'C1' }], error: null }),
        ],
        invoices: [],
        payments: [chain({ data: null, error: null })],
      })

      await syncBusiness(db, 'biz-1')

      expect(updatedRun!['status']).toBe('partial')
      expect(updatedRun!['error_count']).toBe(1)
      expect((updatedRun!['error_detail'] as string[])[0]).toMatch(/invoices.*timeout/)
    })
  })
})
