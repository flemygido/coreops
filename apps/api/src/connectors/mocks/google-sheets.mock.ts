// Mock Google Sheets connector.
// Real integration: OAuth2 + Sheets API v4, reading a fixed-column-layout
// spreadsheet. This is the practical fallback for businesses that export
// Tally/manual ledgers to Sheets rather than running a live accounting API —
// see ADR-0004 for why this matters more than it might first appear.

import type {
  AccountingConnector,
  ConnectorCredentials,
  ConnectorCustomer,
  ConnectorInvoice,
  ConnectorPayment,
  TestConnectionResult,
} from '../types.js'

export class GoogleSheetsMockConnector implements AccountingConnector {
  readonly provider = 'google_sheets' as const

  constructor(private readonly credentials: ConnectorCredentials) {}

  async testConnection(): Promise<TestConnectionResult> {
    if (!this.credentials.access_token || !this.credentials.spreadsheet_id) {
      return {
        ok: false,
        message: 'Missing required credentials: access_token and spreadsheet_id',
      }
    }
    return { ok: true, message: 'Connected to Google Sheets (mock)' }
  }

  async fetchCustomers(): Promise<ConnectorCustomer[]> {
    return [
      { external_id: 'SHEET-CUST-001', name: 'Vikram Stores', phone: '+919812345201', email: null },
    ]
  }

  async fetchInvoices(): Promise<ConnectorInvoice[]> {
    return [
      {
        external_id: 'SHEET-INV-001',
        customer_external_id: 'SHEET-CUST-001',
        invoice_number: 'SH-001',
        amount: 12000,
        amount_paid: 0,
        currency: 'INR',
        issue_date: '2026-05-10',
        due_date: '2026-06-09',
        status: 'open',
      },
    ]
  }

  async fetchPayments(): Promise<ConnectorPayment[]> {
    return []
  }
}
