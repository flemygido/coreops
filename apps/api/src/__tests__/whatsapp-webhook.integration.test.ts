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

  // ── POST inbound message → 24h window recorded in DB ───────────────────────
  // End-to-end: the route looks up connected_accounts, matches phone_number_id,
  // and upserts a row in whatsapp_windows. Tests the full path from HTTP to DB.

  describe('POST /webhooks/whatsapp — window recording', () => {
    const TEST_PNID = 'test-webhook-pnid-window'
    let testBusinessId: string
    let testUserId: string

    beforeAll(async () => {
      const { encrypt } = await import('../lib/crypto.js')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = admin as any

      // businesses.owner_user_id is NOT NULL + FK → auth.users, so we must
      // create a real auth user first via the Auth Admin API (service role only).
      const { data: authData, error: authErr } = await db.auth.admin.createUser({
        email: `webhook-window-test-${Date.now()}@test.coreops.local`,
        password: 'TestPass1234!',
        email_confirm: true,
      })
      if (authErr) throw new Error(`Create auth user failed: ${authErr.message}`)
      testUserId = authData.user.id

      const { data: biz, error: bizErr } = await db
        .from('businesses')
        .insert({
          name: 'Webhook Window Test Business',
          owner_phone: '+910000000099',
          owner_user_id: testUserId,
        })
        .select('id')
        .single()
      if (bizErr) throw new Error(`Insert business failed: ${bizErr.message}`)
      testBusinessId = (biz as { id: string }).id

      const encryptedCreds = encrypt(
        JSON.stringify({ access_token: 'fake', phone_number_id: TEST_PNID })
      )
      const { error: accErr } = await db.from('connected_accounts').insert({
        business_id: testBusinessId,
        provider: 'whatsapp',
        credentials_encrypted: encryptedCreds,
        is_active: true,
      })
      if (accErr) throw new Error(`Insert connected_account failed: ${(accErr as Error).message}`)
    })

    afterAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = admin as any
      await db.from('whatsapp_windows').delete().eq('business_id', testBusinessId)
      await db.from('connected_accounts').delete().eq('business_id', testBusinessId)
      await db.from('businesses').delete().eq('id', testBusinessId)
      if (testUserId) await db.auth.admin.deleteUser(testUserId)
    })

    it('upserts a 24h window row when an inbound message arrives', async () => {
      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '+1 555 670 2281',
                    phone_number_id: TEST_PNID,
                  },
                  messages: [
                    {
                      from: '919751723512',
                      id: 'wamid.windowtest001',
                      timestamp: String(Math.floor(Date.now() / 1000)),
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': sign(payload, APP_SECRET),
        },
        payload,
      })

      expect(res.statusCode).toBe(200)

      // Handler is now synchronous (process-then-respond), so the window is
      // already in the DB by the time inject resolves
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: win, error: winErr } = await (admin as any)
        .from('whatsapp_windows')
        .select('recipient_phone, window_expires_at')
        .eq('business_id', testBusinessId)
        .eq('recipient_phone', '+919751723512')
        .maybeSingle()

      expect(winErr).toBeNull()
      expect(win).not.toBeNull()
      // Window must expire > 23h from now
      expect(
        new Date((win as { window_expires_at: string }).window_expires_at).getTime()
      ).toBeGreaterThan(Date.now() + 23 * 3600 * 1000)
    })

    it('refreshes (extends) the window on a second inbound message', async () => {
      // Seed a nearly-expired window
      const almostExpired = new Date(Date.now() + 60 * 1000).toISOString() // 1 min from now
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('whatsapp_windows').upsert(
        {
          business_id: testBusinessId,
          recipient_phone: '+919751723512',
          window_expires_at: almostExpired,
        },
        { onConflict: 'business_id,recipient_phone' }
      )

      const payload = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '+1 555 670 2281', phone_number_id: TEST_PNID },
                  messages: [
                    {
                      from: '919751723512',
                      id: 'wamid.refresh001',
                      timestamp: String(Date.now()),
                      type: 'text',
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      })

      await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': sign(payload, APP_SECRET),
        },
        payload,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: win } = await (admin as any)
        .from('whatsapp_windows')
        .select('window_expires_at')
        .eq('business_id', testBusinessId)
        .eq('recipient_phone', '+919751723512')
        .maybeSingle()

      // Window should now expire ~24h from now, not in 1 minute
      expect(
        new Date((win as { window_expires_at: string }).window_expires_at).getTime()
      ).toBeGreaterThan(Date.now() + 23 * 3600 * 1000)
    })
  })
})
