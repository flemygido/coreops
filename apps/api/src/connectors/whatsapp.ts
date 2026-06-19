// Real WhatsApp Business Cloud API connector.
// API version: v23.0
// Two explicit send paths keep billing and compliance concerns separate:
//   sendSessionMessage()  — free-form text, only valid inside an open 24h CSW
//   sendTemplateMessage() — pre-approved utility template, works cold (no window)
// sendMessage() dispatches based on live window state in the DB.
// Feature-flagged: WHATSAPP_ENABLED=true required; falls back to mock otherwise.

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ConnectorCredentials,
  MessagePayload,
  MessagingConnector,
  SendMessageResult,
  TestConnectionResult,
  WhatsAppTemplateVars,
} from './types.js'

const API_VERSION = 'v23.0'
const GRAPH_BASE = 'https://graph.facebook.com'

// No open 24h service window — caller must use the template path or open a window first.
export class WhatsAppNoWindowError extends Error {
  readonly code = 'WHATSAPP_NO_WINDOW' as const
  constructor(phone: string) {
    super(
      `No open 24-hour service window for ${phone}. ` +
        'Provide template_vars in the MessagePayload to use a pre-approved template instead.'
    )
    this.name = 'WhatsAppNoWindowError'
  }
}

// Template not configured or not yet approved in Meta Business Manager.
// Fails loudly because silently skipping an overdue follow-up is worse than crashing.
export class WhatsAppNoTemplateError extends Error {
  readonly code = 'WHATSAPP_NO_TEMPLATE' as const
  constructor() {
    super(
      'Cannot send: no open service window and WHATSAPP_TEMPLATE_NAME is not configured. ' +
        'Register and get a utility template approved in Meta Business Manager before going live.'
    )
    this.name = 'WhatsAppNoTemplateError'
  }
}

interface GraphApiSuccess {
  messaging_product: 'whatsapp'
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string; message_status?: string }>
}

interface GraphApiError {
  error: { code: number; message: string; type: string; fbtrace_id?: string }
}

// Strips all non-digit characters and prepends '+'.
// Meta webhook delivers sender phones as digits-only (e.g. "919751723512");
// customer.phone in the DB may include spaces or dashes.
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `+${digits}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export class WhatsAppConnector implements MessagingConnector {
  readonly provider = 'whatsapp' as const

  constructor(
    private readonly credentials: ConnectorCredentials,
    private readonly supabase?: SupabaseClient,
    private readonly businessId?: string
  ) {}

  async testConnection(): Promise<TestConnectionResult> {
    const { access_token, phone_number_id } = this.credentials
    if (!access_token || !phone_number_id) {
      return {
        ok: false,
        message: 'Missing required credentials: access_token and phone_number_id',
      }
    }
    try {
      const res = await fetch(
        `${GRAPH_BASE}/${API_VERSION}/${phone_number_id}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      )
      if (!res.ok) {
        const err = (await res.json()) as GraphApiError
        return {
          ok: false,
          message: `WhatsApp API error ${err.error?.code}: ${err.error?.message ?? res.statusText}`,
        }
      }
      const data = (await res.json()) as { display_phone_number?: string; verified_name?: string }
      return {
        ok: true,
        message: `Connected to WhatsApp Business Cloud API (${data.display_phone_number ?? phone_number_id})`,
      }
    } catch (err) {
      return { ok: false, message: `Network error: ${(err as Error).message}` }
    }
  }

  // Dispatches to the free session path when a window is open, or the template
  // path when it is not. If neither path is available, throws loudly.
  async sendMessage(payload: MessagePayload): Promise<SendMessageResult> {
    const phone = normalizePhone(payload.to)
    const hasWindow = await this.checkWindow(phone)

    if (hasWindow) {
      return this.sendSessionMessage(phone, payload.body)
    }

    if (!payload.template_vars) throw new WhatsAppNoWindowError(phone)
    if (!this.credentials.template_name) throw new WhatsAppNoTemplateError()

    return this.sendTemplateMessage(phone, payload.template_vars)
  }

  // Free-form message inside an open 24h customer service window.
  // Used for owner briefings (owner has been chatting with the bot).
  async sendSessionMessage(to: string, body: string): Promise<SendMessageResult> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body },
    })
  }

  // Pre-approved utility template send. Does NOT require an open window.
  // Template parameter order: {{1}} customer_name, {{2}} invoice_number,
  // {{3}} amount, {{4}} days_overdue — must match the approved template exactly.
  async sendTemplateMessage(to: string, vars: WhatsAppTemplateVars): Promise<SendMessageResult> {
    if (!this.credentials.template_name) throw new WhatsAppNoTemplateError()
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: this.credentials.template_name,
        language: { code: this.credentials.template_language ?? 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: vars.customer_name },
              { type: 'text', text: vars.invoice_number },
              { type: 'text', text: vars.amount },
              { type: 'text', text: vars.days_overdue },
            ],
          },
        ],
      },
    })
  }

  // Called by the inbound webhook handler to open/refresh a 24h service window.
  async recordInboundMessage(senderPhone: string): Promise<void> {
    if (!this.supabase || !this.businessId) return
    const phone = normalizePhone(senderPhone)
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)
    await this.supabase.from('whatsapp_windows').upsert(
      {
        business_id: this.businessId,
        recipient_phone: phone,
        window_expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'business_id,recipient_phone' }
    )
  }

  private async checkWindow(normalizedPhone: string): Promise<boolean> {
    if (!this.supabase || !this.businessId) return false
    const { data } = await this.supabase
      .from('whatsapp_windows')
      .select('window_expires_at')
      .eq('business_id', this.businessId)
      .eq('recipient_phone', normalizedPhone)
      .gt('window_expires_at', new Date().toISOString())
      .maybeSingle()
    return data !== null
  }

  private async post(body: unknown, retries = 2): Promise<SendMessageResult> {
    const { access_token, phone_number_id } = this.credentials
    const url = `${GRAPH_BASE}/${API_VERSION}/${phone_number_id}/messages`

    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const data = (await res.json()) as GraphApiSuccess
        return {
          ok: true,
          provider_message_id: data.messages?.[0]?.id ?? null,
          message: 'Message sent successfully',
        }
      }

      const errData = (await res.json()) as GraphApiError
      const code = errData.error?.code
      const msg = errData.error?.message ?? 'Unknown error'

      // Throughput (130429) or pair (131056) rate limit — retry with backoff
      if ((code === 130429 || code === 131056) && attempt < retries) {
        await sleep(1000 * Math.pow(2, attempt))
        continue
      }

      // Outside 24h window — surface as typed error so the caller can react
      if (code === 131047) {
        const to =
          typeof body === 'object' && body !== null && 'to' in body
            ? String((body as Record<string, unknown>).to)
            : 'unknown'
        throw new WhatsAppNoWindowError(to)
      }

      // Template does not exist or is not approved
      if (code === 132000 || code === 132001) throw new WhatsAppNoTemplateError()

      return {
        ok: false,
        provider_message_id: null,
        message: `WhatsApp API error ${code}: ${msg}`,
      }
    }

    return { ok: false, provider_message_id: null, message: 'Max retries exceeded' }
  }
}
