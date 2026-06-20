import { describe, it, expect } from 'vitest'
import {
  getAccountingConnector,
  getMessagingConnector,
  isAccountingProvider,
  isMessagingProvider,
} from '../registry.js'
import { ZohoBooksConnector } from '../zoho-books.js'
import { ZohoBooksMockConnector } from '../mocks/zoho-books.mock.js'
import { WhatsAppConnector } from '../whatsapp.js'
import { WhatsAppMockConnector } from '../mocks/whatsapp.mock.js'

describe('provider classification', () => {
  it('classifies accounting providers correctly', () => {
    expect(isAccountingProvider('zoho_books')).toBe(true)
    expect(isAccountingProvider('tally')).toBe(true)
    expect(isAccountingProvider('google_sheets')).toBe(true)
    expect(isAccountingProvider('whatsapp')).toBe(false)
    expect(isAccountingProvider('gmail')).toBe(false)
  })

  it('classifies messaging providers correctly', () => {
    expect(isMessagingProvider('whatsapp')).toBe(true)
    expect(isMessagingProvider('gmail')).toBe(true)
    expect(isMessagingProvider('zoho_books')).toBe(false)
  })
})

describe('getAccountingConnector', () => {
  it('returns a connector matching the requested provider', () => {
    const zoho = getAccountingConnector('zoho_books', {})
    expect(zoho.provider).toBe('zoho_books')

    const tally = getAccountingConnector('tally', {})
    expect(tally.provider).toBe('tally')

    const sheets = getAccountingConnector('google_sheets', {})
    expect(sheets.provider).toBe('google_sheets')
  })

  // ── Credential-based routing (no env flag) ─────────────────────────────────
  // These tests prove that a real connected_accounts row with OAuth credentials
  // always routes to the real connector, regardless of any env flag.
  // The failure mode they guard against: "real credentials present, env flag
  // forgotten → mock connector used silently → fabricated data served as real."

  it('routes zoho_books to ZohoBooksConnector when client_id is present', () => {
    // No ZOHO_ENABLED in env — routing must work on credentials alone.
    delete process.env.ZOHO_ENABLED
    const connector = getAccountingConnector('zoho_books', {
      client_id: 'real-client-id',
      client_secret: 'real-secret',
      refresh_token: 'real-token',
      organization_id: '12345',
    })
    expect(connector).toBeInstanceOf(ZohoBooksConnector)
    expect(connector).not.toBeInstanceOf(ZohoBooksMockConnector)
  })

  it('routes zoho_books to ZohoBooksMockConnector when client_id is absent', () => {
    const connector = getAccountingConnector('zoho_books', {})
    expect(connector).toBeInstanceOf(ZohoBooksMockConnector)
    expect(connector).not.toBeInstanceOf(ZohoBooksConnector)
  })

  it('routes zoho_books to mock even with ZOHO_ENABLED=true if no client_id', () => {
    // Proves env flag alone cannot promote credentials to real — credentials drive routing.
    process.env.ZOHO_ENABLED = 'true'
    const connector = getAccountingConnector('zoho_books', {})
    expect(connector).toBeInstanceOf(ZohoBooksMockConnector)
    delete process.env.ZOHO_ENABLED
  })
})

describe('getMessagingConnector', () => {
  it('returns a connector matching the requested provider', () => {
    const whatsapp = getMessagingConnector('whatsapp', {})
    expect(whatsapp.provider).toBe('whatsapp')

    const gmail = getMessagingConnector('gmail', {})
    expect(gmail.provider).toBe('gmail')
  })

  // ── Credential-based routing ────────────────────────────────────────────────

  it('routes whatsapp to WhatsAppConnector when access_token is present', () => {
    delete process.env.WHATSAPP_ENABLED
    const connector = getMessagingConnector('whatsapp', {
      access_token: 'real-token',
      phone_number_id: 'real-phone-id',
    })
    expect(connector).toBeInstanceOf(WhatsAppConnector)
    expect(connector).not.toBeInstanceOf(WhatsAppMockConnector)
  })

  it('routes whatsapp to WhatsAppMockConnector when access_token is absent', () => {
    const connector = getMessagingConnector('whatsapp', {})
    expect(connector).toBeInstanceOf(WhatsAppMockConnector)
    expect(connector).not.toBeInstanceOf(WhatsAppConnector)
  })

  it('routes whatsapp to mock even with WHATSAPP_ENABLED=true if no access_token', () => {
    process.env.WHATSAPP_ENABLED = 'true'
    const connector = getMessagingConnector('whatsapp', {})
    expect(connector).toBeInstanceOf(WhatsAppMockConnector)
    delete process.env.WHATSAPP_ENABLED
  })
})
