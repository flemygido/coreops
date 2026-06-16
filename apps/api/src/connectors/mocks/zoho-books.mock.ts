// Mock Zoho Books connector.
// Real API: REST v3, base https://www.zohoapis.com/books/v3, OAuth2 access_token
// + organization_id required on every request (100 req/min rate limit).
// This mock never calls the network — it validates credential shape and
// returns a small deterministic dataset so the sync pipeline (Phase 5) can be
// built and tested against a stable contract before live wiring.

import type {
  AccountingConnector,
  ConnectorCredentials,
  ConnectorCustomer,
  ConnectorInvoice,
  ConnectorPayment,
  TestConnectionResult,
} from '../types.js'

export class ZohoBooksMockConnector implements AccountingConnector {
  readonly provider = 'zoho_books' as const

  constructor(private readonly credentials: ConnectorCredentials) {}

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.credentials.access_token || !this.credentials.organization_id) {
      return {
        ok: false,
        message: 'Missing required credentials: access_token and organization_id',
      }
    }
    return { ok: true, message: 'Connected to Zoho Books (mock)' }
  }

  async fetchCustomers(): Promise<ConnectorCustomer[]> {
    return [
      {
        external_id: 'ZB-CUST-001',
        name: 'Aarav Traders',
        phone: '+919812345001',
        email: 'aarav@traders.example',
      },
      {
        external_id: 'ZB-CUST-002',
        name: 'Priya Distributors',
        phone: '+919812345002',
        email: 'priya@distributors.example',
      },
      { external_id: 'ZB-CUST-003', name: 'Kiran Wholesale', phone: '+919812345003', email: null },
    ]
  }

  async fetchInvoices(): Promise<ConnectorInvoice[]> {
    return [
      {
        external_id: 'ZB-INV-001',
        customer_external_id: 'ZB-CUST-001',
        invoice_number: 'ZB-1001',
        amount: 45000,
        amount_paid: 0,
        currency: 'INR',
        issue_date: '2026-05-01',
        due_date: '2026-05-31',
        status: 'open',
      },
      {
        external_id: 'ZB-INV-002',
        customer_external_id: 'ZB-CUST-002',
        invoice_number: 'ZB-1002',
        amount: 22000,
        amount_paid: 22000,
        currency: 'INR',
        issue_date: '2026-04-15',
        due_date: '2026-05-15',
        status: 'paid',
      },
      {
        external_id: 'ZB-INV-003',
        customer_external_id: 'ZB-CUST-003',
        invoice_number: 'ZB-1003',
        amount: 80000,
        amount_paid: 30000,
        currency: 'INR',
        issue_date: '2026-03-01',
        due_date: '2026-03-31',
        status: 'partial',
      },
    ]
  }

  async fetchPayments(): Promise<ConnectorPayment[]> {
    return [
      {
        external_id: 'ZB-PAY-001',
        invoice_external_id: 'ZB-INV-002',
        amount: 22000,
        paid_at: '2026-05-10T10:00:00Z',
        payment_method: 'bank_transfer',
        reference: 'NEFT-998877',
      },
      {
        external_id: 'ZB-PAY-002',
        invoice_external_id: 'ZB-INV-003',
        amount: 30000,
        paid_at: '2026-03-20T09:30:00Z',
        payment_method: 'upi',
        reference: 'UPI-554433',
      },
    ]
  }
}
