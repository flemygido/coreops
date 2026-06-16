// Mock WhatsApp connector.
// Real API: POST https://graph.facebook.com/v22.0/{phone_number_id}/messages
// with a Bearer access_token. Template messages are the only message type
// allowed outside the 24h customer service window — see the WhatsApp
// Pricing Architecture Rule in CLAUDE.md. Routine owner briefings must ride
// free utility/service-window messages, never paid marketing templates.

import type {
  ConnectorCredentials,
  MessagePayload,
  MessagingConnector,
  SendMessageResult,
  TestConnectionResult,
} from '../types.js'

export class WhatsAppMockConnector implements MessagingConnector {
  readonly provider = 'whatsapp' as const

  constructor(private readonly credentials: ConnectorCredentials) {}

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.credentials.access_token || !this.credentials.phone_number_id) {
      return {
        ok: false,
        message: 'Missing required credentials: access_token and phone_number_id',
      }
    }
    return { ok: true, message: 'Connected to WhatsApp Business Cloud API (mock)' }
  }

  async sendMessage(payload: MessagePayload): Promise<SendMessageResult> {
    return {
      ok: true,
      provider_message_id: `wamid.mock.${Date.now()}`,
      message: `Mock-sent WhatsApp message to ${payload.to}`,
    }
  }
}
