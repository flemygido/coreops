// Sends one approved follow-up via the business's configured messaging connector.
// Routes through the real WhatsApp connector (WHATSAPP_ENABLED=true) or the mock.
// Loads invoice data to populate template_vars for the cold-outreach template path,
// so the connector can send a pre-approved utility template when no service window is open.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '../lib/crypto.js'
import { getMessagingConnector, isMessagingProvider } from '../connectors/index.js'
import type {
  ConnectorCredentials,
  MessagingProvider,
  WhatsAppTemplateVars,
} from '../connectors/index.js'

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
  name: string
  phone: string | null
}

interface InvoiceRow {
  invoice_number: string
  amount: number
  amount_paid: number
  due_date: string
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

  // Load customer name + phone
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('name, phone')
    .eq('id', fu.customer_id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (custErr) throw new Error(custErr.message)
  const cust = customer as CustomerRow | null
  if (!cust?.phone) {
    throw new Error(`Customer has no phone number — cannot send WhatsApp message`)
  }

  // Load invoice for template variable population
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('invoice_number, amount, amount_paid, due_date')
    .eq('id', fu.invoice_id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (invErr) throw new Error(invErr.message)

  let templateVars: WhatsAppTemplateVars | undefined
  if (invoice) {
    const inv = invoice as InvoiceRow
    const outstanding = Number(inv.amount) - Number(inv.amount_paid)
    const daysOverdue = Math.max(
      0,
      Math.floor((Date.now() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24))
    )
    templateVars = {
      customer_name: cust.name,
      invoice_number: inv.invoice_number,
      amount: `₹${outstanding.toLocaleString('en-IN')}`,
      days_overdue: String(daysOverdue),
    }
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
    const provider = account.provider as MessagingProvider
    if (!isMessagingProvider(provider)) {
      throw new Error(`Provider ${account.provider} is not a messaging provider`)
    }
    const credentials = JSON.parse(decrypt(account.credentials_encrypted)) as ConnectorCredentials
    const connector = getMessagingConnector(provider, credentials, { supabase, businessId })
    sendResult = await connector.sendMessage({
      to: cust.phone,
      body: fu.drafted_text,
      template_vars: templateVars,
    })
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
