import { describe, it, expect } from 'vitest'
import {
  getAccountingConnector,
  getMessagingConnector,
  isAccountingProvider,
  isMessagingProvider,
} from '../registry.js'

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
})

describe('getMessagingConnector', () => {
  it('returns a connector matching the requested provider', () => {
    const whatsapp = getMessagingConnector('whatsapp', {})
    expect(whatsapp.provider).toBe('whatsapp')

    const gmail = getMessagingConnector('gmail', {})
    expect(gmail.provider).toBe('gmail')
  })
})
