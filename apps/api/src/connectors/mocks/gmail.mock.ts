// Mock Gmail connector. Real integration: Gmail API v1, OAuth2, used as a
// fallback follow-up channel (email) when WhatsApp isn't available, or to
// read remittance-advice emails in a future ingestion phase. v1 scope is
// send-only, matching the receivables-recovery wedge.

import type {
  ConnectorCredentials,
  MessagePayload,
  MessagingConnector,
  SendMessageResult,
  TestConnectionResult,
} from '../types.js'

export class GmailMockConnector implements MessagingConnector {
  readonly provider = 'gmail' as const

  constructor(private readonly credentials: ConnectorCredentials) {}

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.credentials.access_token) {
      return { ok: false, message: 'Missing required credential: access_token' }
    }
    return { ok: true, message: 'Connected to Gmail API (mock)' }
  }

  async sendMessage(payload: MessagePayload): Promise<SendMessageResult> {
    return {
      ok: true,
      provider_message_id: `gmail.mock.${Date.now()}`,
      message: `Mock-sent email to ${payload.to}`,
    }
  }
}
