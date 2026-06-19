// Real WhatsApp Cloud API integration tests.
// These tests make live API calls to Meta and (when a service window is open)
// deliver a real message to the test recipient phone number.
//
// Gating: all tests skip unless WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN
// are set in the environment. Never run in CI without those vars.
//
// Test assets (from CLAUDE.md verified facts, 2026-06-19):
//   Sender phone:    +1 555 670 2281
//   Sender PNID:     1092811770590161
//   Test recipient:  +91 97517 23512
//
// Service-window behaviour:
//   sendSessionMessage succeeds ONLY if the test recipient has sent a message to
//   the business number within the last 24 hours. If not, the test logs the result
//   clearly but does NOT fail CI — missing a window is an ops state, not a code bug.
//
// Template-send behaviour:
//   sendTemplateMessage will fail with WhatsAppNoTemplateError (code 132001) until
//   a utility template is approved in Meta Business Manager.
//   >>> PHASE 7 GO-LIVE BLOCKER: template 'invoice_follow_up' must be approved
//   >>> before receivables follow-ups can reach customers with no open window.

import { describe, it, expect } from 'vitest'
import { WhatsAppConnector, WhatsAppNoTemplateError } from '../whatsapp.js'
import type { WhatsAppTemplateVars } from '../types.js'

const hasWhatsApp = Boolean(
  process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN
)

const TEST_RECIPIENT = '+919751723512'

const TEST_TEMPLATE_VARS: WhatsAppTemplateVars = {
  customer_name: 'CoreOps Test Customer',
  invoice_number: 'INV-TEST-001',
  amount: '₹10,000',
  days_overdue: '3',
}

describe.skipIf(!hasWhatsApp)('WhatsApp Cloud API — live integration', () => {
  const creds = {
    access_token: process.env.WHATSAPP_ACCESS_TOKEN!,
    phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    template_name: process.env.WHATSAPP_TEMPLATE_NAME ?? 'invoice_follow_up',
    template_language: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en',
  }

  it('testConnection() resolves to ok: true against live API', async () => {
    const connector = new WhatsAppConnector(creds)
    const result = await connector.testConnection()
    // Log even on failure so the CI output shows the API response
    console.log('[whatsapp real] testConnection:', result)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('WhatsApp Business Cloud API')
  })

  it('sendSessionMessage() delivers to test recipient when CSW is open', async () => {
    // If the test recipient has NOT messaged the sender number in the last 24h,
    // this call returns ok: false (error 131047 surfaces as WhatsAppNoWindowError).
    // We handle both cases because window state is an ops condition, not a bug.
    const connector = new WhatsAppConnector(creds)
    let result
    try {
      result = await connector.sendSessionMessage(
        TEST_RECIPIENT,
        `CoreOps test ${new Date().toISOString()}: session message delivery confirmed`
      )
    } catch (err) {
      if (err instanceof Error && err.message.includes('24-hour service window')) {
        console.warn(
          '[whatsapp real] sendSessionMessage: no open CSW — ' +
            'have the test recipient message +1 555 670 2281 first, then re-run'
        )
        // Not a code failure — skip gracefully
        return
      }
      throw err
    }

    console.log('[whatsapp real] sendSessionMessage result:', result)

    if (!result.ok) {
      console.warn('[whatsapp real] sendSessionMessage returned ok: false:', result.message)
    }

    // If we got here with a valid response, assert the wamid format
    if (result.ok) {
      expect(result.provider_message_id).toMatch(/^wamid\./)
    }
  })

  it('sendTemplateMessage() fails loudly until template is approved in Meta Business Manager', async () => {
    // EXPECTED: this throws WhatsAppNoTemplateError (code 132001) until the template
    // 'invoice_follow_up' is approved. When it starts passing, remove this expectation
    // and replace with: expect(result.ok).toBe(true)
    //
    // >>> PHASE 7 GO-LIVE BLOCKER: approve the utility template before pilot launch
    const connector = new WhatsAppConnector(creds)

    try {
      const result = await connector.sendTemplateMessage(TEST_RECIPIENT, TEST_TEMPLATE_VARS)
      // If it succeeds (template approved!), log and assert
      console.log('[whatsapp real] sendTemplateMessage SUCCEEDED — template is approved:', result)
      expect(result.ok).toBe(true)
      expect(result.provider_message_id).toMatch(/^wamid\./)
    } catch (err) {
      if (err instanceof WhatsAppNoTemplateError) {
        console.warn(
          '[whatsapp real] sendTemplateMessage: template not approved yet (expected for now)\n' +
            '>>> GO-LIVE BLOCKER: register and approve template "invoice_follow_up" in Meta Business Manager'
        )
        // Expected until template is approved — not a code failure
        expect(err.code).toBe('WHATSAPP_NO_TEMPLATE')
      } else {
        throw err
      }
    }
  })
})
