// Database row types — mirrors the Postgres schema exactly.
// Use these as the single source of truth across API and dashboard.

export type Provider = 'zoho_books' | 'tally' | 'whatsapp' | 'gmail' | 'google_sheets'
export type InvoiceStatus = 'open' | 'partial' | 'paid' | 'void' | 'written_off'
export type BriefingStatus = 'draft' | 'sent' | 'failed'
export type FollowUpStatus = 'draft' | 'approved' | 'sent' | 'failed' | 'skipped'
export type DataPrincipalType = 'business_owner' | 'customer'

export interface Business {
  id: string
  owner_user_id: string
  name: string
  owner_phone: string | null
  gstin: string | null
  timezone: string
  created_at: string
  updated_at: string
}

export interface ConnectedAccount {
  id: string
  business_id: string
  provider: Provider
  credentials_encrypted: string | null
  metadata: Record<string, unknown>
  is_active: boolean
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  business_id: string
  external_id: string | null
  name: string
  phone: string | null
  email: string | null
  credit_limit: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Invoice {
  id: string
  business_id: string
  customer_id: string
  external_id: string | null
  invoice_number: string
  amount: number
  amount_paid: number
  currency: string
  issue_date: string // ISO date string YYYY-MM-DD
  due_date: string // ISO date string YYYY-MM-DD
  status: InvoiceStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Payment {
  id: string
  business_id: string
  invoice_id: string
  external_id: string | null
  amount: number // negative for credit notes
  paid_at: string
  payment_method: string | null
  reference: string | null
  notes: string | null
  created_at: string
}

export interface Briefing {
  id: string
  business_id: string
  generated_at: string
  sent_at: string | null
  status: BriefingStatus
  summary_text: string | null
  content_json: Record<string, unknown>
  total_overdue: number | null
  invoice_count: number | null
}

export interface FollowUp {
  id: string
  business_id: string
  briefing_id: string | null
  invoice_id: string
  customer_id: string
  drafted_text: string
  status: FollowUpStatus
  approved_at: string | null
  sent_at: string | null
  whatsapp_message_id: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: number
  business_id: string | null
  actor_user_id: string | null
  action: string
  table_name: string | null
  record_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface ConsentRecord {
  id: string
  business_id: string
  data_principal_type: DataPrincipalType
  data_principal_id: string | null
  data_principal_identifier: string | null
  purpose: string
  given_at: string
  withdrawn_at: string | null
  ip_address: string | null
  consent_version: string
  created_at: string
}
