// Provider-abstracted connector contracts.
// A "connector" is the only thing in the codebase allowed to know about a
// specific third-party API shape (Zoho Books, Tally, WhatsApp, ...).
// Everything else — sync logic, routes, services — talks to these interfaces.
//
// Phase 3 ships mock implementations only. Real network calls to Zoho/Tally/
// WhatsApp are deferred until a pilot confirms which provider to wire up live
// (see ADR-0004) — building real connectors before that is speculative scope.

import type { Provider, InvoiceStatus } from '@coreops/shared'

export type { Provider }

export interface ConnectorCredentials {
  [key: string]: string
}

export interface TestConnectionResult {
  ok: boolean
  message: string
}

// ── Accounting connectors (Zoho Books, Tally, Google Sheets) ─────────────────

export interface ConnectorCustomer {
  external_id: string
  name: string
  phone: string | null
  email: string | null
}

export interface ConnectorInvoice {
  external_id: string
  customer_external_id: string
  invoice_number: string
  amount: number
  amount_paid: number
  currency: string
  issue_date: string // YYYY-MM-DD
  due_date: string // YYYY-MM-DD
  status: InvoiceStatus
}

export interface ConnectorPayment {
  external_id: string
  invoice_external_id: string
  amount: number
  paid_at: string // ISO timestamp
  payment_method: string | null
  reference: string | null
}

export interface AccountingConnector {
  readonly provider: Provider
  testConnection(): Promise<TestConnectionResult>
  fetchCustomers(): Promise<ConnectorCustomer[]>
  fetchInvoices(): Promise<ConnectorInvoice[]>
  fetchPayments(): Promise<ConnectorPayment[]>
}

// ── Messaging connectors (WhatsApp, Gmail) ────────────────────────────────────

export interface MessagePayload {
  to: string
  body: string
}

export interface SendMessageResult {
  ok: boolean
  provider_message_id: string | null
  message: string
}

export interface MessagingConnector {
  readonly provider: Provider
  testConnection(): Promise<TestConnectionResult>
  sendMessage(payload: MessagePayload): Promise<SendMessageResult>
}

export const ACCOUNTING_PROVIDERS = ['zoho_books', 'tally', 'google_sheets'] as const
export const MESSAGING_PROVIDERS = ['whatsapp', 'gmail'] as const

export type AccountingProvider = (typeof ACCOUNTING_PROVIDERS)[number]
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number]
