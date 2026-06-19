// Unit tests for ZohoBooksConnector.
// All external calls (fetch, Supabase) are mocked — no network, no DB.
// Covers: credential validation, field mapping, status translation, pagination,
// 429 rate-limit backoff, 401 auto-refresh, token persistence, and typed errors.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { ZohoBooksConnector, ZohoBooksAuthError, ZohoBooksRateLimitError } from '../zoho-books.js'
import type { ConnectorCredentials } from '../types.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCreds(overrides: Partial<ConnectorCredentials> = {}): ConnectorCredentials {
  return {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    refresh_token: 'test-refresh-token',
    access_token: 'test-access-token',
    // expires far in the future by default so isTokenValid() returns true
    access_token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    organization_id: 'test-org-123',
    ...overrides,
  }
}

function makeConnector(creds: ConnectorCredentials = makeCreds()) {
  return new ZohoBooksConnector(creds)
}

function mockOkFetch(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

// Zoho single-page list response wrapper
function zohoList<T>(key: string, items: T[], hasMore = false) {
  return {
    code: 0,
    message: 'success',
    page_context: { page: 1, per_page: 200, has_more_page: hasMore },
    [key]: items,
  }
}

// ── testConnection() ─────────────────────────────────────────────────────────

describe('ZohoBooksConnector', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('testConnection()', () => {
    it('returns ok: false when client_id is missing', async () => {
      const c = makeConnector(makeCreds({ client_id: '' }))
      const r = await c.testConnection()
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/client_id/)
    })

    it('returns ok: false when refresh_token is missing', async () => {
      const c = makeConnector(makeCreds({ refresh_token: '' }))
      const r = await c.testConnection()
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/refresh_token/)
    })

    it('returns ok: true when the organizations endpoint succeeds', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch({ organizations: [{ name: 'Sharma Distributors Pvt Ltd' }] })
      )
      const c = makeConnector()
      const r = await c.testConnection()
      expect(r.ok).toBe(true)
      expect(r.message).toMatch(/Sharma Distributors/)
    })

    it('returns ok: false when auth throws', async () => {
      // No access_token + no client_secret → refresh fails immediately
      const creds = makeCreds({ access_token: '', access_token_expires_at: '', client_secret: '' })
      const c = makeConnector(creds)
      const r = await c.testConnection()
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/client_secret/)
    })
  })

  // ── fetchCustomers() ────────────────────────────────────────────────────────

  describe('fetchCustomers()', () => {
    it('maps contact fields to ConnectorCustomer', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(
          zohoList('contacts', [
            {
              contact_id: 'CUST-001',
              contact_name: 'Sharma Traders',
              mobile: '+919812345001',
              phone: '+911123456789',
              email: 'sharma@traders.example',
            },
          ])
        )
      )
      const [c] = await makeConnector().fetchCustomers()
      expect(c.external_id).toBe('CUST-001')
      expect(c.name).toBe('Sharma Traders')
      expect(c.email).toBe('sharma@traders.example')
    })

    it('prefers mobile over phone', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(
          zohoList('contacts', [
            { contact_id: 'C1', contact_name: 'A', mobile: '+91999', phone: '+91888', email: '' },
          ])
        )
      )
      const [c] = await makeConnector().fetchCustomers()
      expect(c.phone).toBe('+91999')
    })

    it('falls back to phone when mobile is absent', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(
          zohoList('contacts', [
            { contact_id: 'C1', contact_name: 'A', mobile: '', phone: '+91888', email: '' },
          ])
        )
      )
      const [c] = await makeConnector().fetchCustomers()
      expect(c.phone).toBe('+91888')
    })

    it('returns null phone when both mobile and phone are empty', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(
          zohoList('contacts', [
            { contact_id: 'C1', contact_name: 'A', mobile: '', phone: '', email: 'a@b.com' },
          ])
        )
      )
      const [c] = await makeConnector().fetchCustomers()
      expect(c.phone).toBeNull()
    })

    it('returns null email when email is empty', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(
          zohoList('contacts', [
            { contact_id: 'C1', contact_name: 'A', mobile: '+91111', phone: '', email: '' },
          ])
        )
      )
      const [c] = await makeConnector().fetchCustomers()
      expect(c.email).toBeNull()
    })

    it('paginates until has_more_page is false', async () => {
      const page1 = {
        ...zohoList(
          'contacts',
          [{ contact_id: 'C1', contact_name: 'A', mobile: '', phone: '', email: '' }],
          true
        ),
        page_context: { page: 1, per_page: 200, has_more_page: true },
      }
      const page2 = {
        ...zohoList(
          'contacts',
          [{ contact_id: 'C2', contact_name: 'B', mobile: '', phone: '', email: '' }],
          false
        ),
        page_context: { page: 2, per_page: 200, has_more_page: false },
      }
      let call = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          call++
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => (call === 1 ? page1 : page2),
          })
        })
      )
      const contacts = await makeConnector().fetchCustomers()
      expect(contacts).toHaveLength(2)
      expect(contacts[0].external_id).toBe('C1')
      expect(contacts[1].external_id).toBe('C2')
    })
  })

  // ── fetchInvoices() ─────────────────────────────────────────────────────────

  describe('fetchInvoices()', () => {
    const baseInvoice = {
      invoice_id: 'INV-001',
      customer_id: 'CUST-001',
      invoice_number: 'ZB-2026-001',
      date: '2026-05-01',
      due_date: '2026-05-31',
      total: 50000,
      balance: 50000,
      status: 'overdue',
      currency_code: 'INR',
    }

    it('maps overdue → open status', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(zohoList('invoices', [{ ...baseInvoice, status: 'overdue' }]))
      )
      const [inv] = await makeConnector().fetchInvoices()
      expect(inv.status).toBe('open')
    })

    it('maps partially_paid → partial status', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(zohoList('invoices', [{ ...baseInvoice, status: 'partially_paid' }]))
      )
      const [inv] = await makeConnector().fetchInvoices()
      expect(inv.status).toBe('partial')
    })

    it('maps paid → paid status', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(zohoList('invoices', [{ ...baseInvoice, status: 'paid', balance: 0 }]))
      )
      const [inv] = await makeConnector().fetchInvoices()
      expect(inv.status).toBe('paid')
    })

    it('maps void → void status', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(zohoList('invoices', [{ ...baseInvoice, status: 'void', balance: 0 }]))
      )
      const [inv] = await makeConnector().fetchInvoices()
      expect(inv.status).toBe('void')
    })

    it('derives amount_paid from total minus balance', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(zohoList('invoices', [{ ...baseInvoice, total: 80000, balance: 30000 }]))
      )
      const [inv] = await makeConnector().fetchInvoices()
      expect(inv.amount).toBe(80000)
      expect(inv.amount_paid).toBe(50000) // 80000 - 30000
    })

    it('clamps amount_paid to 0 when balance > total (data anomaly)', async () => {
      vi.stubGlobal(
        'fetch',
        mockOkFetch(zohoList('invoices', [{ ...baseInvoice, total: 10000, balance: 15000 }]))
      )
      const [inv] = await makeConnector().fetchInvoices()
      expect(inv.amount_paid).toBe(0)
    })

    it('retries once after 429 then succeeds', async () => {
      vi.useFakeTimers()
      let attempt = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          attempt++
          if (attempt === 1) {
            return Promise.resolve({
              ok: false,
              status: 429,
              json: async () => ({}),
              text: async () => '',
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => zohoList('invoices', [baseInvoice]),
          })
        })
      )

      // Attach resolution handler before advancing timers to avoid unhandled rejections
      const promise = makeConnector().fetchInvoices()
      const settled = promise
        .then((v) => ({ ok: true, value: v }))
        .catch((e) => ({ ok: false, error: e }))
      await vi.runAllTimersAsync()
      const result = await settled

      expect(result.ok).toBe(true)
      if (result.ok) expect((result as { ok: true; value: typeof result }).value).toHaveLength(1)
      expect(attempt).toBe(2)
    })

    it('throws ZohoBooksRateLimitError after three 429s', async () => {
      vi.useFakeTimers()
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          json: async () => ({}),
          text: async () => '',
        })
      )

      const promise = makeConnector().fetchInvoices()
      // Attach rejection handler before advancing timers to prevent unhandled rejection warning
      const assertion = expect(promise).rejects.toThrow(ZohoBooksRateLimitError)
      await vi.runAllTimersAsync()
      await assertion
    })

    it('refreshes token on 401 and retries', async () => {
      const creds = makeCreds()
      let attempt = 0
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if ((url as string).includes('/oauth/v2/token')) {
            // Token refresh succeeds
            creds.access_token = 'new-token'
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
            })
          }
          attempt++
          if (attempt === 1) {
            return Promise.resolve({
              ok: false,
              status: 401,
              json: async () => ({}),
              text: async () => 'Unauthorized',
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => zohoList('invoices', [baseInvoice]),
          })
        })
      )

      const c = new ZohoBooksConnector(creds)
      const invoices = await c.fetchInvoices()
      expect(invoices).toHaveLength(1)
    })

    it('throws ZohoBooksAuthError when 401 persists after refresh', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if ((url as string).includes('/oauth/v2/token')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ access_token: 'new-token', expires_in: 3600 }),
            })
          }
          return Promise.resolve({
            ok: false,
            status: 401,
            json: async () => ({}),
            text: async () => 'Still unauthorized',
          })
        })
      )

      await expect(makeConnector().fetchInvoices()).rejects.toThrow(ZohoBooksAuthError)
    })
  })

  // ── fetchPayments() ─────────────────────────────────────────────────────────

  describe('fetchPayments()', () => {
    const basePayment = {
      payment_id: 'PAY-001',
      date: '2026-06-10',
      amount: 25000,
      payment_mode: 'bank_transfer',
      reference_number: 'NEFT-998877',
      invoices: [{ invoice_id: 'INV-001', amount_applied: 25000 }],
    }

    it('maps payment fields correctly', async () => {
      vi.stubGlobal('fetch', mockOkFetch(zohoList('customerpayments', [basePayment])))
      const [p] = await makeConnector().fetchPayments()
      expect(p.external_id).toBe('PAY-001')
      expect(p.invoice_external_id).toBe('INV-001')
      expect(p.amount).toBe(25000)
      expect(p.paid_at).toBe('2026-06-10T00:00:00Z')
      expect(p.payment_method).toBe('bank_transfer')
      expect(p.reference).toBe('NEFT-998877')
    })

    it('links to invoices[0] when payment covers multiple invoices', async () => {
      const multiInvoice = {
        ...basePayment,
        invoices: [
          { invoice_id: 'INV-001', amount_applied: 15000 },
          { invoice_id: 'INV-002', amount_applied: 10000 },
        ],
      }
      vi.stubGlobal('fetch', mockOkFetch(zohoList('customerpayments', [multiInvoice])))
      const [p] = await makeConnector().fetchPayments()
      // v1 known limitation: only first invoice is linked
      expect(p.invoice_external_id).toBe('INV-001')
    })

    it('skips payments with no invoices array (advance/unapplied payments)', async () => {
      const advance = { ...basePayment, invoices: [] }
      vi.stubGlobal('fetch', mockOkFetch(zohoList('customerpayments', [advance, basePayment])))
      const payments = await makeConnector().fetchPayments()
      expect(payments).toHaveLength(1)
      expect(payments[0].external_id).toBe('PAY-001')
    })

    it('returns null payment_method when payment_mode is empty', async () => {
      const p = { ...basePayment, payment_mode: '' }
      vi.stubGlobal('fetch', mockOkFetch(zohoList('customerpayments', [p])))
      const [result] = await makeConnector().fetchPayments()
      expect(result.payment_method).toBeNull()
    })
  })

  // ── Token management ─────────────────────────────────────────────────────────

  describe('token management', () => {
    it('skips refresh when token is still valid', async () => {
      const fetchMock = mockOkFetch(zohoList('invoices', []))
      vi.stubGlobal('fetch', fetchMock)
      await makeConnector().fetchInvoices()
      // Only one fetch call (the API call) — no token-refresh call
      const calls = fetchMock.mock.calls as Array<[string]>
      expect(calls.every(([url]) => !url.includes('/oauth/'))).toBe(true)
    })

    it('refreshes when token is expired', async () => {
      const creds = makeCreds({
        access_token: 'old-token',
        access_token_expires_at: new Date(Date.now() - 1000).toISOString(), // expired
      })
      let refreshCalled = false
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if ((url as string).includes('/oauth/v2/token')) {
            refreshCalled = true
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ access_token: 'fresh-token', expires_in: 3600 }),
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => zohoList('invoices', []),
          })
        })
      )
      await new ZohoBooksConnector(creds).fetchInvoices()
      expect(refreshCalled).toBe(true)
      expect(creds.access_token).toBe('fresh-token')
    })

    it('persists refreshed token to Supabase when context is provided', async () => {
      const creds = makeCreds({ access_token: '', access_token_expires_at: '' })
      const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
      const supabaseMock = { from: vi.fn().mockReturnValue({ update: updateMock }) }

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if ((url as string).includes('/oauth/v2/token')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ access_token: 'persisted-token', expires_in: 3600 }),
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => zohoList('invoices', []),
          })
        })
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = new ZohoBooksConnector(creds, supabaseMock as any, 'acct-uuid-123')
      await c.fetchInvoices()

      expect(supabaseMock.from).toHaveBeenCalledWith('connected_accounts')
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ credentials_encrypted: expect.any(String) })
      )
    })

    it('does not crash when Supabase context is absent during refresh', async () => {
      const creds = makeCreds({ access_token: '', access_token_expires_at: '' })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if ((url as string).includes('/oauth/v2/token')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ access_token: 'token', expires_in: 3600 }),
            })
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => zohoList('invoices', []),
          })
        })
      )
      // No supabase context passed
      await expect(new ZohoBooksConnector(creds).fetchInvoices()).resolves.not.toThrow()
    })

    it('throws ZohoBooksAuthError when refresh endpoint returns an error field', async () => {
      const creds = makeCreds({ access_token: '', access_token_expires_at: '' })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ error: 'invalid_client' }),
        })
      )
      await expect(new ZohoBooksConnector(creds).fetchInvoices()).rejects.toThrow(
        ZohoBooksAuthError
      )
    })
  })

  // ── ZohoBooksAuthError / ZohoBooksRateLimitError ─────────────────────────────

  describe('typed error codes', () => {
    it('ZohoBooksAuthError has code ZOHO_AUTH_ERROR', () => {
      const e = new ZohoBooksAuthError('test')
      expect(e.code).toBe('ZOHO_AUTH_ERROR')
      expect(e.name).toBe('ZohoBooksAuthError')
    })

    it('ZohoBooksRateLimitError has code ZOHO_RATE_LIMIT', () => {
      const e = new ZohoBooksRateLimitError()
      expect(e.code).toBe('ZOHO_RATE_LIMIT')
      expect(e.name).toBe('ZohoBooksRateLimitError')
    })
  })
})
