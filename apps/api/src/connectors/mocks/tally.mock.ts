// Mock Tally connector.
//
// IMPORTANT (see ADR-0004): Tally Prime has no cloud API. It only exposes
// XML-over-HTTP or ODBC on the local network where Tally runs. A real
// connector requires a lightweight on-premise agent that talks to Tally
// locally and relays data to CoreOps over HTTPS — this is materially more
// infrastructure than Zoho's OAuth2 REST API and is deferred until a
// Tally-based pilot is confirmed.
//
// The credential shape below (`agent_url`) anticipates that future design:
// the business runs an agent on their LAN and registers its callback URL.

import type {
  AccountingConnector,
  ConnectorCredentials,
  ConnectorCustomer,
  ConnectorInvoice,
  ConnectorPayment,
  TestConnectionResult,
} from '../types.js'

export class TallyMockConnector implements AccountingConnector {
  readonly provider = 'tally' as const

  constructor(private readonly credentials: ConnectorCredentials) {}

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.credentials.agent_url) {
      return {
        ok: false,
        message: 'Missing required credential: agent_url (on-premise Tally agent endpoint)',
      }
    }
    return { ok: true, message: 'Connected to Tally agent (mock)' }
  }

  async fetchCustomers(): Promise<ConnectorCustomer[]> {
    return [
      {
        external_id: 'TALLY-CUST-001',
        name: 'Ramesh Hardware',
        phone: '+919812345101',
        email: null,
      },
      {
        external_id: 'TALLY-CUST-002',
        name: 'Sunita General Store',
        phone: '+919812345102',
        email: null,
      },
    ]
  }

  async fetchInvoices(): Promise<ConnectorInvoice[]> {
    return [
      {
        external_id: 'TALLY-INV-001',
        customer_external_id: 'TALLY-CUST-001',
        invoice_number: 'TLY/2026/0042',
        amount: 18500,
        amount_paid: 0,
        currency: 'INR',
        issue_date: '2026-04-20',
        due_date: '2026-05-20',
        status: 'open',
      },
      {
        external_id: 'TALLY-INV-002',
        customer_external_id: 'TALLY-CUST-002',
        invoice_number: 'TLY/2026/0043',
        amount: 9200,
        amount_paid: 9200,
        currency: 'INR',
        issue_date: '2026-04-22',
        due_date: '2026-05-22',
        status: 'paid',
      },
    ]
  }

  async fetchPayments(): Promise<ConnectorPayment[]> {
    return [
      {
        external_id: 'TALLY-PAY-001',
        invoice_external_id: 'TALLY-INV-002',
        amount: 9200,
        paid_at: '2026-05-18T12:00:00Z',
        payment_method: 'cash',
        reference: null,
      },
    ]
  }
}
