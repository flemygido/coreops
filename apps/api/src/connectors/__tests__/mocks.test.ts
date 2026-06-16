import { describe, it, expect } from 'vitest'
import { ZohoBooksMockConnector } from '../mocks/zoho-books.mock.js'
import { TallyMockConnector } from '../mocks/tally.mock.js'
import { GoogleSheetsMockConnector } from '../mocks/google-sheets.mock.js'
import { WhatsAppMockConnector } from '../mocks/whatsapp.mock.js'
import { GmailMockConnector } from '../mocks/gmail.mock.js'

describe('ZohoBooksMockConnector', () => {
  it('fails testConnection without required credentials', async () => {
    const connector = new ZohoBooksMockConnector({})
    const result = await connector.testConnection()
    expect(result.ok).toBe(false)
  })

  it('succeeds testConnection with required credentials', async () => {
    const connector = new ZohoBooksMockConnector({ access_token: 'x', organization_id: 'y' })
    const result = await connector.testConnection()
    expect(result.ok).toBe(true)
  })

  it('returns deterministic customers, invoices, payments', async () => {
    const connector = new ZohoBooksMockConnector({ access_token: 'x', organization_id: 'y' })
    const customers = await connector.fetchCustomers()
    const invoices = await connector.fetchInvoices()
    const payments = await connector.fetchPayments()

    expect(customers.length).toBeGreaterThan(0)
    expect(invoices.length).toBeGreaterThan(0)
    expect(payments.length).toBeGreaterThan(0)

    // Every invoice's customer_external_id resolves to a real customer
    const customerIds = new Set(customers.map((c) => c.external_id))
    for (const inv of invoices) {
      expect(customerIds.has(inv.customer_external_id)).toBe(true)
    }

    // Every payment's invoice_external_id resolves to a real invoice
    const invoiceIds = new Set(invoices.map((i) => i.external_id))
    for (const pay of payments) {
      expect(invoiceIds.has(pay.invoice_external_id)).toBe(true)
    }
  })
})

describe('TallyMockConnector', () => {
  it('fails testConnection without agent_url', async () => {
    const connector = new TallyMockConnector({})
    const result = await connector.testConnection()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('agent_url')
  })

  it('succeeds testConnection with agent_url', async () => {
    const connector = new TallyMockConnector({ agent_url: 'http://192.168.1.10:9000' })
    const result = await connector.testConnection()
    expect(result.ok).toBe(true)
  })

  it('returns referentially consistent mock data', async () => {
    const connector = new TallyMockConnector({ agent_url: 'http://192.168.1.10:9000' })
    const customers = await connector.fetchCustomers()
    const invoices = await connector.fetchInvoices()
    const customerIds = new Set(customers.map((c) => c.external_id))
    for (const inv of invoices) {
      expect(customerIds.has(inv.customer_external_id)).toBe(true)
    }
  })
})

describe('GoogleSheetsMockConnector', () => {
  it('fails testConnection without credentials', async () => {
    const connector = new GoogleSheetsMockConnector({})
    const result = await connector.testConnection()
    expect(result.ok).toBe(false)
  })

  it('succeeds with access_token and spreadsheet_id', async () => {
    const connector = new GoogleSheetsMockConnector({ access_token: 'x', spreadsheet_id: 'y' })
    const result = await connector.testConnection()
    expect(result.ok).toBe(true)
  })
})

describe('WhatsAppMockConnector', () => {
  it('fails testConnection without phone_number_id', async () => {
    const connector = new WhatsAppMockConnector({ access_token: 'x' })
    const result = await connector.testConnection()
    expect(result.ok).toBe(false)
  })

  it('sendMessage returns a provider_message_id', async () => {
    const connector = new WhatsAppMockConnector({ access_token: 'x', phone_number_id: 'y' })
    const result = await connector.sendMessage({ to: '+919876543210', body: 'Test' })
    expect(result.ok).toBe(true)
    expect(result.provider_message_id).toBeTruthy()
  })
})

describe('GmailMockConnector', () => {
  it('fails testConnection without access_token', async () => {
    const connector = new GmailMockConnector({})
    const result = await connector.testConnection()
    expect(result.ok).toBe(false)
  })

  it('sendMessage returns a provider_message_id', async () => {
    const connector = new GmailMockConnector({ access_token: 'x' })
    const result = await connector.sendMessage({ to: 'owner@example.com', body: 'Test' })
    expect(result.ok).toBe(true)
    expect(result.provider_message_id).toBeTruthy()
  })
})
