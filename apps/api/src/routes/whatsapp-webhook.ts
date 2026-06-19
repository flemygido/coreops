// WhatsApp Business Cloud API webhook receiver.
// GET  /webhooks/whatsapp — Meta's one-time verification challenge
// POST /webhooks/whatsapp — inbound messages and delivery status updates
//
// Inbound messages open a 24-hour free service window for that sender, which
// allows the owner to reply with a free-form session message instead of a
// paid utility template.
//
// Signature verification: Meta signs each POST with HMAC-SHA256 keyed on
// WHATSAPP_APP_SECRET, delivered in the X-Hub-Signature-256 header.
// We capture the raw body via preParsing before Fastify's JSON parser consumes it.

import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { decrypt } from '../lib/crypto.js'

interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: string
}

interface WhatsAppWebhookPayload {
  object: string
  entry?: Array<{
    id: string
    changes?: Array<{
      value: {
        messaging_product: string
        metadata: { display_phone_number: string; phone_number_id: string }
        messages?: WhatsAppMessage[]
        statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>
      }
      field: string
    }>
  }>
}

interface HubQuery {
  'hub.mode'?: string
  'hub.challenge'?: string
  'hub.verify_token'?: string
}

// Exported so it can be unit-tested independently.
export function verifySignature(rawBody: Buffer, appSecret: string, sigHeader: string): boolean {
  const sig = sigHeader.startsWith('sha256=') ? sigHeader.slice(7) : sigHeader
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    // Buffer lengths differ — sig is definitely wrong
    return false
  }
}

export const whatsappWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Capture the raw request body before Fastify's JSON parser consumes the stream.
  // Returning a new Readable from the same bytes lets the parser proceed normally.
  // Hook is scoped to this plugin — other routes keep the default JSON parser.
  app.addHook('preParsing', async (_req, _reply, payload) => {
    const chunks: Buffer[] = []
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
    }
    const rawBody = Buffer.concat(chunks)
    ;(_req as FastifyRequest & { rawBody?: Buffer }).rawBody = rawBody
    return Readable.from([rawBody]) as NodeJS.ReadableStream
  })

  // Webhook verification challenge from Meta (one-time, during webhook registration)
  app.get<{ Querystring: HubQuery }>('/webhooks/whatsapp', async (req, reply) => {
    const mode = req.query['hub.mode']
    const challenge = req.query['hub.challenge']
    const token = req.query['hub.verify_token']
    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

    if (!expectedToken) {
      req.log.error('WHATSAPP_WEBHOOK_VERIFY_TOKEN not set — cannot accept webhook challenge')
      return reply.status(500).send({ error: 'Webhook not configured' })
    }

    if (mode === 'subscribe' && token === expectedToken) {
      req.log.info('WhatsApp webhook verification accepted')
      return reply.status(200).send(parseInt(challenge ?? '0', 10))
    }

    req.log.warn({ mode }, 'WhatsApp webhook challenge rejected — verify token mismatch')
    return reply.status(403).send({ error: 'Forbidden' })
  })

  // Inbound messages + delivery status callbacks from Meta
  app.post<{ Body: WhatsAppWebhookPayload }>('/webhooks/whatsapp', async (req, reply) => {
    const appSecret = process.env.WHATSAPP_APP_SECRET
    if (appSecret) {
      const sigHeader = req.headers['x-hub-signature-256'] as string | undefined
      if (!sigHeader) {
        req.log.warn('WhatsApp webhook POST missing X-Hub-Signature-256')
        return reply.status(401).send({ error: 'Missing signature' })
      }
      const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0)
      if (!verifySignature(rawBody, appSecret, sigHeader)) {
        req.log.warn('WhatsApp webhook signature mismatch — request rejected')
        return reply.status(403).send({ error: 'Invalid signature' })
      }
    } else {
      req.log.warn(
        'WHATSAPP_APP_SECRET not set — signature verification skipped (unsafe in production)'
      )
    }

    // Process entries first (all DB writes are fast < 100ms), then respond.
    // Meta requires a 200 within 20s — this stays well under that budget and
    // makes the handler fully synchronous so tests can assert DB state after inject.
    const body = req.body
    if (body?.entry) {
      for (const entry of body.entry) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'messages') continue
          const { metadata, messages } = change.value
          for (const msg of messages ?? []) {
            await recordServiceWindow(app, metadata.phone_number_id, msg.from, req)
          }
        }
      }
    }

    return reply.status(200).send()
  })
}

async function recordServiceWindow(
  app: FastifyInstance,
  phoneNumberId: string,
  senderPhone: string,
  req: FastifyRequest
): Promise<void> {
  const supabase = app.supabaseAdmin

  // Locate the connected account whose credentials contain this phone_number_id
  const { data: accounts, error } = await supabase
    .from('connected_accounts')
    .select('business_id, credentials_encrypted')
    .eq('provider', 'whatsapp')
    .eq('is_active', true)

  if (error) {
    req.log.error({ error }, 'Failed to query connected_accounts for WhatsApp window')
    return
  }
  if (!accounts?.length) {
    req.log.warn({ phoneNumberId }, 'No active WhatsApp connected account found')
    return
  }

  const matched = accounts.find((a) => {
    try {
      const creds = JSON.parse(decrypt(a.credentials_encrypted)) as Record<string, string>
      return creds.phone_number_id === phoneNumberId
    } catch {
      return false
    }
  })

  if (!matched) {
    req.log.warn({ phoneNumberId }, 'No matching business for incoming WhatsApp phone_number_id')
    return
  }

  // Normalize: Meta sends digits-only (e.g. "919751723512"); store as E.164 (+919751723512)
  const normalized = senderPhone.startsWith('+') ? senderPhone : `+${senderPhone}`
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + 24)

  const { error: upsertErr } = await supabase.from('whatsapp_windows').upsert(
    {
      business_id: matched.business_id,
      recipient_phone: normalized,
      window_expires_at: expiresAt.toISOString(),
    },
    { onConflict: 'business_id,recipient_phone' }
  )

  if (upsertErr) {
    req.log.error({ upsertErr, senderPhone }, 'Failed to record WhatsApp service window')
  } else {
    req.log.info(
      { businessId: matched.business_id, senderPhone, expiresAt },
      'WhatsApp service window recorded'
    )
  }
}
