// WhatsApp webhook route integration tests.
// Covers: verification challenge, signature enforcement, and window recording.
// The live-send tests (sendSessionMessage, sendTemplateMessage against real Meta API)
// are in connectors/__tests__/whatsapp-real.integration.test.ts and are gated
// on WHATSAPP_PHONE_NUMBER_ID being set.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { createApp } from '../app.js'
import { loadEnv } from '../env.js'

const hasSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY
)

const VERIFY_TOKEN = 'test-verify-token-12345'
const APP_SECRET = 'test-app-secret-abcdef'

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')
}

describe.skipIf(!hasSupabase)('WhatsApp webhook routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: any
  let admin: ReturnType<typeof createClient>

  const originalEnv = {
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,
  }

  beforeAll(async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN
    process.env.WHATSAPP_APP_SECRET = APP_SECRET

    const env = loadEnv()
    app = await createApp(env)
    await app.ready()

    admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  })

  afterAll(async () => {
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalEnv.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? ''
    process.env.WHATSAPP_APP_SECRET = originalEnv.WHATSAPP_APP_SECRET ?? ''
    await app?.close()
  })

  afterEach(async () => {
    // Clean up any windows created during tests
    await admin.from('whatsapp_windows').delete().neq('id', 0)
  })

  // ── GET: verification challenge ─────────────────────────────────────────────

  describe('GET /webhooks/whatsapp — verification challenge', () => {
    it('returns the challenge number when mode and token match', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.challenge': '987654321',
          'hub.verify_token': VERIFY_TOKEN,
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toBe(987654321)
    })

    it('returns 403 when verify token does not match', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.challenge': '111',
          'hub.verify_token': 'wrong-token',
        },
      })
      expect(res.statusCode).toBe(403)
    })

    it('returns 403 when mode is not subscribe', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'unsubscribe',
          'hub.challenge': '111',
          'hub.verify_token': VERIFY_TOKEN,
        },
      })
      expect(res.statusCode).toBe(403)
    })
  })

  // ── POST: signature verification ────────────────────────────────────────────

  describe('POST /webhooks/whatsapp — signature enforcement', () => {
    const statusPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '+1 555 670 2281', phone_number_id: 'pnid-xxx' },
                statuses: [
                  {
                    id: 'wamid.xxx',
                    status: 'delivered',
                    timestamp: '1234',
                    recipient_id: '91xyz',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    })

    it('returns 200 with valid X-Hub-Signature-256', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': sign(statusPayload, APP_SECRET),
        },
        payload: statusPayload,
      })
      expect(res.statusCode).toBe(200)
    })

    it('returns 403 with a tampered signature', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=deadbeef1234567890abcdef',
        },
        payload: statusPayload,
      })
      expect(res.statusCode).toBe(403)
    })

    it('returns 401 when X-Hub-Signature-256 header is absent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: { 'content-type': 'application/json' },
        payload: statusPayload,
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // ── verifySignature unit coverage (fast, no HTTP) ───────────────────────────

  describe('verifySignature()', () => {
    it('returns true for a correct HMAC-SHA256 signature', async () => {
      const { verifySignature } = await import('../routes/whatsapp-webhook.js')
      const body = Buffer.from('{"test":1}')
      const sig = sign('{"test":1}', APP_SECRET)
      expect(verifySignature(body, APP_SECRET, sig)).toBe(true)
    })

    it('returns false for a wrong signature', async () => {
      const { verifySignature } = await import('../routes/whatsapp-webhook.js')
      const body = Buffer.from('{"test":1}')
      expect(verifySignature(body, APP_SECRET, 'sha256=0000')).toBe(false)
    })

    it('returns false when sig and expected have different byte lengths', async () => {
      const { verifySignature } = await import('../routes/whatsapp-webhook.js')
      const body = Buffer.from('x')
      expect(verifySignature(body, APP_SECRET, 'sha256=ab')).toBe(false)
    })
  })
})
