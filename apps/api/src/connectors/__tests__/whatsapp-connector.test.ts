import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  WhatsAppConnector,
  WhatsAppNoWindowError,
  WhatsAppNoTemplateError,
  normalizePhone,
} from '../whatsapp.js'
import type { WhatsAppTemplateVars } from '../types.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CREDS = {
  access_token: 'test-token',
  phone_number_id: 'pnid-123',
}

const CREDS_WITH_TEMPLATE = {
  ...CREDS,
  template_name: 'invoice_follow_up',
  template_language: 'en',
}

const TEMPLATE_VARS: WhatsAppTemplateVars = {
  customer_name: 'Sharma Traders',
  invoice_number: 'INV-1001',
  amount: '₹50,000',
  days_overdue: '5',
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

function makeConnectorWithWindow(windowOpen: boolean) {
  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      maybeSingle: vi.fn().mockResolvedValue({
        data: windowOpen
          ? { window_expires_at: new Date(Date.now() + 86400000).toISOString() }
          : null,
        error: null,
      }),
    }),
  }
  return {
    supabase: supabase as unknown as Parameters<
      typeof WhatsAppConnector.prototype.recordInboundMessage
    >[0],
    connector: new WhatsAppConnector(CREDS_WITH_TEMPLATE, supabase as never, 'biz-1'),
  }
}

// ── normalizePhone ────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  it('prepends + to digits-only phone (Meta webhook format)', () => {
    expect(normalizePhone('919751723512')).toBe('+919751723512')
  })

  it('strips spaces and non-digits', () => {
    expect(normalizePhone('+91 97517 23512')).toBe('+919751723512')
  })

  it('passes through already-normalized E.164', () => {
    expect(normalizePhone('+919751723512')).toBe('+919751723512')
  })
})

// ── testConnection ────────────────────────────────────────────────────────────

describe('WhatsAppConnector.testConnection()', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns ok: false when credentials are missing', async () => {
    const c = new WhatsAppConnector({})
    const result = await c.testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Missing required credentials/)
  })

  it('returns ok: true with phone display name on success', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, { display_phone_number: '+1 555 670 2281', verified_name: 'CoreOps Test' })
    )
    const c = new WhatsAppConnector(CREDS)
    const result = await c.testConnection()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('+1 555 670 2281')
  })

  it('returns ok: false with error detail on API failure', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(401, {
        error: { code: 190, message: 'Invalid OAuth access token', type: 'OAuthException' },
      })
    )
    const c = new WhatsAppConnector(CREDS)
    const result = await c.testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('190')
    expect(result.message).toContain('Invalid OAuth access token')
  })
})

// ── sendSessionMessage ────────────────────────────────────────────────────────

describe('WhatsAppConnector.sendSessionMessage()', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a text message to the Graph API and returns the wamid', async () => {
    const fetchMock = mockFetch(200, {
      messaging_product: 'whatsapp',
      contacts: [{ input: '+919751723512', wa_id: '919751723512' }],
      messages: [{ id: 'wamid.abc123' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const c = new WhatsAppConnector(CREDS)
    const result = await c.sendSessionMessage('+919751723512', 'Hello!')

    expect(result.ok).toBe(true)
    expect(result.provider_message_id).toBe('wamid.abc123')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('v23.0/pnid-123/messages')
    expect(JSON.parse(init.body as string)).toMatchObject({
      type: 'text',
      to: '+919751723512',
      text: { body: 'Hello!' },
    })
  })

  it('returns ok: false on non-retryable API error', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, {
        error: { code: 100, message: 'Invalid parameter', type: 'GraphMethodException' },
      })
    )
    const c = new WhatsAppConnector(CREDS)
    const result = await c.sendSessionMessage('+919751723512', 'Hi')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('100')
  })

  it('retries on throughput rate limit (130429) and succeeds on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ error: { code: 130429, message: 'Throughput limit' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messaging_product: 'whatsapp',
            contacts: [],
            messages: [{ id: 'wamid.retry' }],
          }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const c = new WhatsAppConnector(CREDS)
    const result = await c.sendSessionMessage('+919751723512', 'Retried')
    expect(result.ok).toBe(true)
    expect(result.provider_message_id).toBe('wamid.retry')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws WhatsAppNoWindowError when API returns 131047', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, {
        error: {
          code: 131047,
          message: 'Message failed to send because more than 24 hours have passed',
          type: 'OAuthException',
        },
      })
    )
    const c = new WhatsAppConnector(CREDS)
    await expect(c.sendSessionMessage('+919751723512', 'Late!')).rejects.toThrow(
      WhatsAppNoWindowError
    )
  })
})

// ── sendTemplateMessage ───────────────────────────────────────────────────────

describe('WhatsAppConnector.sendTemplateMessage()', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the correct template JSON with four body parameters', async () => {
    const fetchMock = mockFetch(200, {
      messaging_product: 'whatsapp',
      contacts: [],
      messages: [{ id: 'wamid.tmpl1' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const c = new WhatsAppConnector(CREDS_WITH_TEMPLATE)
    const result = await c.sendTemplateMessage('+919751723512', TEMPLATE_VARS)

    expect(result.ok).toBe(true)
    expect(result.provider_message_id).toBe('wamid.tmpl1')

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.type).toBe('template')
    expect(body.template.name).toBe('invoice_follow_up')
    expect(body.template.language.code).toBe('en')
    expect(body.template.components[0].type).toBe('body')
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Sharma Traders' },
      { type: 'text', text: 'INV-1001' },
      { type: 'text', text: '₹50,000' },
      { type: 'text', text: '5' },
    ])
  })

  it('throws WhatsAppNoTemplateError when template_name credential is missing', async () => {
    const c = new WhatsAppConnector(CREDS) // no template_name
    await expect(c.sendTemplateMessage('+919751723512', TEMPLATE_VARS)).rejects.toThrow(
      WhatsAppNoTemplateError
    )
  })

  it('throws WhatsAppNoTemplateError when API returns 132001', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(400, { error: { code: 132001, message: 'Template does not exist' } })
    )
    const c = new WhatsAppConnector(CREDS_WITH_TEMPLATE)
    await expect(c.sendTemplateMessage('+919751723512', TEMPLATE_VARS)).rejects.toThrow(
      WhatsAppNoTemplateError
    )
  })
})

// ── sendMessage dispatch ──────────────────────────────────────────────────────

describe('WhatsAppConnector.sendMessage() dispatch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes to sendSessionMessage when service window is open', async () => {
    const fetchMock = mockFetch(200, {
      messaging_product: 'whatsapp',
      contacts: [],
      messages: [{ id: 'wamid.session' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const { connector } = makeConnectorWithWindow(true)
    const result = await connector.sendMessage({ to: '+919751723512', body: 'Hello' })

    expect(result.ok).toBe(true)
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.type).toBe('text')
  })

  it('routes to sendTemplateMessage when window is closed and template_vars are provided', async () => {
    const fetchMock = mockFetch(200, {
      messaging_product: 'whatsapp',
      contacts: [],
      messages: [{ id: 'wamid.tmpl' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const { connector } = makeConnectorWithWindow(false)
    const result = await connector.sendMessage({
      to: '+919751723512',
      body: 'LLM drafted text',
      template_vars: TEMPLATE_VARS,
    })

    expect(result.ok).toBe(true)
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.type).toBe('template')
  })

  it('throws WhatsAppNoWindowError when window is closed and no template_vars provided', async () => {
    const { connector } = makeConnectorWithWindow(false)
    await expect(connector.sendMessage({ to: '+919751723512', body: 'Some text' })).rejects.toThrow(
      WhatsAppNoWindowError
    )
  })

  it('throws WhatsAppNoTemplateError when window is closed, template_vars provided, but template_name missing from credentials', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }
    const connector = new WhatsAppConnector(CREDS, supabase as never, 'biz-1') // no template_name
    await expect(
      connector.sendMessage({ to: '+919751723512', body: 'text', template_vars: TEMPLATE_VARS })
    ).rejects.toThrow(WhatsAppNoTemplateError)
  })

  it('without supabase context assumes no window and throws WhatsAppNoWindowError', async () => {
    const connector = new WhatsAppConnector(CREDS_WITH_TEMPLATE) // no supabase
    await expect(connector.sendMessage({ to: '+919751723512', body: 'text' })).rejects.toThrow(
      WhatsAppNoWindowError
    )
  })
})

// ── recordInboundMessage ──────────────────────────────────────────────────────

describe('WhatsAppConnector.recordInboundMessage()', () => {
  it('upserts a 24h window row in whatsapp_windows', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
    }
    const connector = new WhatsAppConnector(CREDS, supabase as never, 'biz-42')
    await connector.recordInboundMessage('919751723512')

    expect(upsertMock).toHaveBeenCalledOnce()
    const [row, opts] = upsertMock.mock.calls[0] as [Record<string, string>, { onConflict: string }]
    expect(row.business_id).toBe('biz-42')
    expect(row.recipient_phone).toBe('+919751723512')
    expect(new Date(row.window_expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000)
    expect(opts.onConflict).toBe('business_id,recipient_phone')
  })

  it('is a no-op when supabase or businessId is absent', async () => {
    const connector = new WhatsAppConnector(CREDS) // no supabase
    await expect(connector.recordInboundMessage('919751723512')).resolves.toBeUndefined()
  })
})
