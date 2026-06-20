// Connector factory. Routes and sync logic call these functions instead of
// importing a provider implementation directly — swapping a mock for a real
// connector later is a one-line change here, nowhere else.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ZohoBooksMockConnector } from './mocks/zoho-books.mock.js'
import { ZohoBooksConnector } from './zoho-books.js'
import { TallyMockConnector } from './mocks/tally.mock.js'
import { GoogleSheetsMockConnector } from './mocks/google-sheets.mock.js'
import { WhatsAppMockConnector } from './mocks/whatsapp.mock.js'
import { GmailMockConnector } from './mocks/gmail.mock.js'
import { WhatsAppConnector } from './whatsapp.js'
import type {
  AccountingConnector,
  AccountingProvider,
  ConnectorCredentials,
  MessagingConnector,
  MessagingProvider,
  Provider,
} from './types.js'
import { ACCOUNTING_PROVIDERS, MESSAGING_PROVIDERS } from './types.js'

export function isAccountingProvider(provider: Provider): provider is AccountingProvider {
  return (ACCOUNTING_PROVIDERS as readonly string[]).includes(provider)
}

export function isMessagingProvider(provider: Provider): provider is MessagingProvider {
  return (MESSAGING_PROVIDERS as readonly string[]).includes(provider)
}

interface AccountingContext {
  supabase?: SupabaseClient
  connectedAccountId?: string
}

export function getAccountingConnector(
  provider: AccountingProvider,
  credentials: ConnectorCredentials,
  context?: AccountingContext
): AccountingConnector {
  switch (provider) {
    case 'zoho_books':
      // Route on credentials, not on an env flag.
      // Real Zoho OAuth credentials always carry client_id; mock/test credentials do not.
      // An env flag as a secondary gate creates a silent-fallback risk: real credentials
      // in the DB get the mock connector if the flag is forgotten, and no error is raised.
      if (credentials.client_id) {
        return new ZohoBooksConnector(credentials, context?.supabase, context?.connectedAccountId)
      }
      return new ZohoBooksMockConnector(credentials)
    case 'tally':
      return new TallyMockConnector(credentials)
    case 'google_sheets':
      return new GoogleSheetsMockConnector(credentials)
  }
}

interface MessagingContext {
  supabase?: SupabaseClient
  businessId?: string
}

export function getMessagingConnector(
  provider: MessagingProvider,
  credentials: ConnectorCredentials,
  context?: MessagingContext
): MessagingConnector {
  switch (provider) {
    case 'whatsapp': {
      // Route on credentials — same principle as zoho_books above.
      // Real WhatsApp credentials always carry access_token; mock credentials do not.
      if (credentials.access_token) {
        return new WhatsAppConnector(credentials, context?.supabase, context?.businessId)
      }
      return new WhatsAppMockConnector(credentials)
    }
    case 'gmail':
      return new GmailMockConnector(credentials)
  }
}
