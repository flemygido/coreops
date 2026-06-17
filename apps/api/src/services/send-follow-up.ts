// Sends one approved follow-up via the business's configured messaging connector
// (WhatsApp mock in Phase 5). Updates status to 'sent' or 'failed' and
// records the provider_message_id. The caller is responsible for confirming
// the follow-up is in 'approved' status before calling this.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../lib/crypto.js'
import { getMessagingConnector, isMessagingProvider } from '../connectors/index.js'
import type { ConnectorCredentials, MessagingProvider } from '../connectors/index.js'

export interface SendFollowUpResult {
  ok: boolean
  whatsapp_message_id: string | null
  message: string
}

interface FollowUpRow {
  id: string
  invoice_id: string
  customer_id: string
  drafted_text: string
  status: string
}

interface CustomerRow {
  phone: string | null
}

interface ConnectedAccountRow {
  id: string
  provider: string
  credentials_encrypted: string
}

export async function sendFollowUp(
  supabase: SupabaseClient,
  businessId: string,
  followUpId: string
): Promise<SendFollowUpResult> {
  // Load the follow-up
  const { data: followUp, error: fuErr } = await supabase
    .from('follow_ups')
    .select('id, invoice_id, customer_id, drafted_text, status')
    .eq('id', followUpId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (fuErr) throw new Error(fuErr.message)
  if (!followUp) throw new Error(`Follow-up ${followUpId} not found`)

  const fu = followUp as FollowUpRow
  if (fu.status !== 'approved') {
    throw new Error(`Follow-up must be approved before sending (current status: ${fu.status})`)
  }

  // Load the customer's phone number
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('phone')
    .eq('id', fu.customer_id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (custErr) throw new Error(custErr.message)
  const cust = customer as CustomerRow | null
  if (!cust?.phone) {
    throw new Error(`Customer has no phone number — cannot send WhatsApp message`)
  }

  // Find an active messaging connector for this business
  const { data: accounts, error: accErr } = await supabase
    .from('connected_accounts')
    .select('id, provider, credentials_encrypted')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .in('provider', ['whatsapp', 'gmail'])
    .limit(1)

  if (accErr) throw new Error(accErr.message)

  let sendResult: { ok: boolean; provider_message_id: string | null; message: string }

  if (!accounts || accounts.length === 0) {
    // No connected messaging account — use the mock (dev/demo mode)
    const { WhatsAppMockConnector } = await import('../connectors/mocks/whatsapp.mock.js')
    const mock = new WhatsAppMockConnector({})
    sendResult = await mock.sendMessage({ to: cust.phone, body: fu.drafted_text })
  } else {
    const account = accounts[0] as ConnectedAccountRow
    // Cast to Provider first so the type guard can narrow to MessagingProvider
    const provider = account.provider as MessagingProvider
    if (!isMessagingProvider(provider)) {
      throw new Error(`Provider ${account.provider} is not a messaging provider`)
    }
    const credentials = JSON.parse(decrypt(account.credentials_encrypted)) as ConnectorCredentials
    const connector = getMessagingConnector(provider, credentials)
    sendResult = await connector.sendMessage({ to: cust.phone, body: fu.drafted_text })
  }

  // Update the follow-up status regardless of send outcome
  const newStatus = sendResult.ok ? 'sent' : 'failed'
  const { error: updateErr } = await supabase
    .from('follow_ups')
    .update({
      status: newStatus,
      ...(sendResult.ok && { sent_at: new Date().toISOString() }),
      whatsapp_message_id: sendResult.provider_message_id,
    })
    .eq('id', followUpId)
    .eq('business_id', businessId)

  if (updateErr) throw new Error(updateErr.message)

  return {
    ok: sendResult.ok,
    whatsapp_message_id: sendResult.provider_message_id,
    message: sendResult.message,
  }
}
