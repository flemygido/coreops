// Connector factory. Routes and sync logic call these functions instead of
// importing a provider implementation directly — swapping a mock for a real
// connector later is a one-line change here, nowhere else.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ZohoBooksMockConnector } from './mocks/zoho-books.mock.js'
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

export function getAccountingConnector(
  provider: AccountingProvider,
  credentials: ConnectorCredentials
): AccountingConnector {
  switch (provider) {
    case 'zoho_books':
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
      // Use the real connector when WHATSAPP_ENABLED=true and credentials have an access token.
      // Falls back to the mock so dev/test flows keep working without live credentials.
      if (process.env.WHATSAPP_ENABLED === 'true' && credentials.access_token) {
        return new WhatsAppConnector(credentials, context?.supabase, context?.businessId)
      }
      return new WhatsAppMockConnector(credentials)
    }
    case 'gmail':
      return new GmailMockConnector(credentials)
  }
}
