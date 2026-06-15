-- CoreOps — Performance Indexes
-- Phase 1: Indexes for the receivables workflow query patterns.

-- Tenant scoping (used in every RLS policy lookup)
create index idx_businesses_owner_user_id on businesses(owner_user_id);

-- Overdue invoice queries: filter by business, status, due_date
create index idx_invoices_business_status on invoices(business_id, status);
create index idx_invoices_due_date on invoices(business_id, due_date)
  where status in ('open', 'partial');

-- Customer lookup by business
create index idx_customers_business on customers(business_id);
create index idx_customers_external_id on customers(business_id, external_id)
  where external_id is not null;

-- Invoice lookup by customer (for aggregating per-customer overdue)
create index idx_invoices_customer on invoices(business_id, customer_id);

-- Payments timeline
create index idx_payments_invoice on payments(invoice_id);
create index idx_payments_business_date on payments(business_id, paid_at desc);

-- Follow-up workflow
create index idx_follow_ups_status on follow_ups(business_id, status);
create index idx_follow_ups_invoice on follow_ups(invoice_id);

-- Audit log queries (always by business + time)
create index idx_audit_log_business_time on audit_log(business_id, created_at desc);

-- Consent records lookup (DPDP rights requests)
create index idx_consent_business_principal
  on consent_records(business_id, data_principal_identifier);
