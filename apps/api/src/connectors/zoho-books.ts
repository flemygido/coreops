// Real Zoho Books REST API v3 connector — reads invoices, payments, and contacts.
// India accounts use the .in regional endpoints (accounts.zoho.in / www.zohoapis.in);
// tokens are region-bound and cannot be used cross-region.
//
// Token management: access_token freshness is checked before every request;
// expired tokens are refreshed with the stored refresh_token and persisted
// back to connected_accounts.credentials_encrypted so successive daily syncs
// reuse the token instead of burning Zoho's token-generation quota.
//
// Routing: the registry resolves this connector when client_id is present in
// credentials; mock credentials (no client_id) get ZohoBooksMockConnector instead.

import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt } from '../lib/crypto.js'
import type {
  AccountingConnector,
  ConnectorCredentials,
  ConnectorCustomer,
  ConnectorInvoice,
  ConnectorPayment,
  TestConnectionResult,
} from './types.js'
import type { InvoiceStatus } from '@coreops/shared'

// Zoho Books invoice statuses → our internal InvoiceStatus
const ZOHO_STATUS_MAP: Record<string, InvoiceStatus> = {
  paid: 'paid',
  void: 'void',
  partially_paid: 'partial',
  overdue: 'open',
  unpaid: 'open',
  sent: 'open',
  draft: 'open',
  viewed: 'open',
}

// ── Typed errors ─────────────────────────────────────────────────────────────

// 401 from the API that can't be resolved by refreshing, or the refresh itself fails.
// Indicates a credential problem the owner must fix (revoked token, wrong region, etc.)
export class ZohoBooksAuthError extends Error {
  readonly code = 'ZOHO_AUTH_ERROR' as const
  constructor(message: string) {
    super(message)
    this.name = 'ZohoBooksAuthError'
  }
}

// 429 after exhausting retries. Caller can back off and retry the whole sync.
export class ZohoBooksRateLimitError extends Error {
  readonly code = 'ZOHO_RATE_LIMIT' as const
  constructor() {
    super('Zoho Books API rate limit reached (100 req/min). Retry after 60 seconds.')
    this.name = 'ZohoBooksRateLimitError'
  }
}

// ── Zoho API response shapes (partial — only fields we consume) ───────────────

interface ZohoInvoice {
  invoice_id: string
  customer_id: string
  invoice_number: string
  date: string // YYYY-MM-DD (issue date)
  due_date: string // YYYY-MM-DD
  total: number
  balance: number // pre-calculated outstanding; amount_paid = total - balance
  status: string
  currency_code: string
}

interface ZohoContact {
  contact_id: string
  contact_name: string
  phone: string
  mobile: string
  email: string
}

interface ZohoPayment {
  payment_id: string
  date: string // YYYY-MM-DD
  amount: number
  payment_mode: string
  reference_number: string
  invoices?: Array<{
    invoice_id: string
    amount_applied: number
  }>
}

interface ZohoListResponse {
  code: number
  message: string
  page_context?: { has_more_page: boolean; page: number; per_page: number }
  [key: string]: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

// ── Connector ────────────────────────────────────────────────────────────────

export class ZohoBooksConnector implements AccountingConnector {
  readonly provider = 'zoho_books' as const

  private readonly apiBase: string
  private readonly authBase: string

  constructor(
    private readonly credentials: ConnectorCredentials,
    private readonly supabase?: SupabaseClient,
    private readonly connectedAccountId?: string
  ) {
    this.apiBase = (credentials.api_domain ?? 'https://www.zohoapis.in').replace(/\/$/, '')
    this.authBase = (credentials.auth_domain ?? 'https://accounts.zoho.in').replace(/\/$/, '')
  }

  async testConnection(): Promise<TestConnectionResult> {
    if (
      !this.credentials.client_id ||
      !this.credentials.refresh_token ||
      !this.credentials.organization_id
    ) {
      return {
        ok: false,
        message:
          'Missing required credentials: client_id, refresh_token, and organization_id are required',
      }
    }
    try {
      // Fetch a single invoice as the health check — requires only ZohoBooks.invoices.READ.
      // The /organizations endpoint needs ZohoBooks.settings.READ which unnecessarily
      // narrows the required OAuth scope set and returns 401 on minimal-scope tokens.
      await this.get<unknown>('invoices', { per_page: '1', page: '1' })
      return {
        ok: true,
        message: `Connected to Zoho Books (org: ${this.credentials.organization_id})`,
      }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  async fetchCustomers(): Promise<ConnectorCustomer[]> {
    const contacts = await this.paginateList<ZohoContact>('contacts', 'contacts')
    return contacts.map((c) => ({
      external_id: c.contact_id,
      name: c.contact_name,
      // Prefer mobile — more reliable for WhatsApp follow-ups in Indian wholesale
      phone: c.mobile || c.phone || null,
      email: c.email || null,
    }))
  }

  async fetchInvoices(): Promise<ConnectorInvoice[]> {
    const invoices = await this.paginateList<ZohoInvoice>('invoices', 'invoices')
    return invoices.map((inv) => ({
      external_id: inv.invoice_id,
      customer_external_id: inv.customer_id,
      invoice_number: inv.invoice_number,
      amount: inv.total,
      // Zoho pre-calculates balance = unpaid outstanding; derive amount_paid from total - balance
      amount_paid: Math.max(0, inv.total - inv.balance),
      currency: inv.currency_code ?? 'INR',
      issue_date: inv.date,
      due_date: inv.due_date,
      status: ZOHO_STATUS_MAP[inv.status] ?? 'open',
    }))
  }

  async fetchPayments(): Promise<ConnectorPayment[]> {
    const payments = await this.paginateList<ZohoPayment>('customerpayments', 'customerpayments')
    const result: ConnectorPayment[] = []
    for (const p of payments) {
      // KNOWN LIMITATION v1: a single payment applied to multiple invoices links only
      // to the first invoice in the array; this can under-count amount_paid on the
      // others. Acceptable for pilot; revisit before scaling.
      // (In Indian wholesale, splitting one payment across several invoices is common.)
      const firstInvoice = p.invoices?.[0]
      if (!firstInvoice) continue // advance/unapplied payment — not yet linked to an invoice
      result.push({
        external_id: p.payment_id,
        invoice_external_id: firstInvoice.invoice_id,
        amount: p.amount,
        // Zoho returns date as YYYY-MM-DD; normalise to midnight UTC ISO timestamp
        paid_at: `${p.date}T00:00:00Z`,
        payment_method: p.payment_mode || null,
        reference: p.reference_number || null,
      })
    }
    return result
  }

  // ── Token management ─────────────────────────────────────────────────────────

  private isTokenValid(): boolean {
    const token = this.credentials.access_token
    const expiresAt = this.credentials.access_token_expires_at
    if (!token || !expiresAt) return false
    // 5-minute buffer so we never send a token that expires mid-request
    return new Date(expiresAt).getTime() > Date.now() + 5 * 60 * 1000
  }

  private async ensureToken(): Promise<void> {
    if (!this.isTokenValid()) {
      await this.refreshToken()
    }
  }

  async refreshToken(): Promise<void> {
    const { client_id, client_secret, refresh_token } = this.credentials
    if (!client_id || !client_secret || !refresh_token) {
      throw new ZohoBooksAuthError(
        'Cannot refresh token: client_id, client_secret, and refresh_token are required'
      )
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id,
      client_secret,
      refresh_token,
    })

    const res = await fetch(`${this.authBase}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    let data: { access_token?: string; expires_in?: number; error?: string }
    try {
      data = (await res.json()) as typeof data
    } catch {
      throw new ZohoBooksAuthError(`Token refresh failed (${res.status}): non-JSON response`)
    }

    if (data.error || !data.access_token) {
      throw new ZohoBooksAuthError(
        `Token refresh error: ${data.error ?? 'no access_token in response'}`
      )
    }

    const expiresIn = data.expires_in ?? 3600 // Zoho default: 1 hour
    this.credentials.access_token = data.access_token
    this.credentials.access_token_expires_at = new Date(Date.now() + expiresIn * 1000).toISOString()

    // Persist the refreshed token so the next sync reuses it instead of
    // burning another token-generation call (important at multi-tenant scale).
    if (this.supabase && this.connectedAccountId) {
      const { error } = await this.supabase
        .from('connected_accounts')
        .update({ credentials_encrypted: encrypt(JSON.stringify(this.credentials)) })
        .eq('id', this.connectedAccountId)

      if (error) {
        // Log but don't throw — the in-memory token is still valid for this sync
        console.warn(`[ZohoBooksConnector] Failed to persist refreshed token: ${error.message}`)
      }
    }
  }

  // ── HTTP layer ───────────────────────────────────────────────────────────────

  // Makes a single GET to the Zoho Books v3 API.
  // Ensures the token is fresh before the first attempt.
  // 401: refreshes once as a safety net (token may have expired between
  //       ensureToken() and the network round-trip) then retries.
  // 429: fixed 60s backoff (Zoho's rate limit resets per minute; no Retry-After documented).
  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    await this.ensureToken()

    const url = new URL(`${this.apiBase}/books/v3/${path}`)
    url.searchParams.set('organization_id', this.credentials.organization_id)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    for (let attempt = 0; attempt <= 2; attempt++) {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Zoho-oauthtoken ${this.credentials.access_token}` },
      })

      if (res.ok) return res.json() as T

      if (res.status === 429) {
        if (attempt < 2) {
          await sleep(60_000)
          continue
        }
        throw new ZohoBooksRateLimitError()
      }

      if (res.status === 401) {
        if (attempt === 0) {
          await this.refreshToken()
          continue
        }
        const text = await res.text()
        throw new ZohoBooksAuthError(`Unauthorized after token refresh: ${text}`)
      }

      const errBody = await res.text()
      throw new Error(`Zoho Books API error ${res.status}: ${errBody}`)
    }

    throw new Error('Max retries exceeded')
  }

  private async paginateList<T>(path: string, listKey: string): Promise<T[]> {
    const all: T[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const data = await this.get<ZohoListResponse>(path, {
        page: String(page),
        per_page: '200',
      })
      const items = (data[listKey] as T[] | undefined) ?? []
      all.push(...items)
      hasMore = data.page_context?.has_more_page ?? false
      page++
    }

    return all
  }
}
