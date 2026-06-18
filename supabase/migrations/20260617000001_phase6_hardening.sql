-- CoreOps — Phase 6: Observability, Security + DPDP Hardening
-- 2026-06-17

-- ── Audit trigger on customers ───────────────────────────────────────────────
-- Customers were the only key table missing audit coverage.
-- DELETE on customers triggers the DPDP erasure audit trail automatically.
create trigger trg_audit_customers
  after insert or update or delete on customers
  for each row execute function audit_log_trigger();

-- ── DPDP: consent_records missing DELETE trigger ─────────────────────────────
-- Consent withdrawal updates withdrawn_at (UPDATE); already covered.
-- Explicit erasure of consent records should also be audited.
create trigger trg_audit_consent_records_delete
  after delete on consent_records
  for each row execute function audit_log_trigger();

-- ── DPDP: mark customer data as erased ───────────────────────────────────────
-- Soft-erase flag so audit_log retains the record_id reference even
-- after the customer row is deleted. The business_summary route uses
-- this to confirm erasure completed.
-- Note: the actual erasure deletes the customer row (cascade handles invoices,
-- follow_ups, payments, consent_records). This table is the tombstone.
create table if not exists erasure_requests (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  customer_id    uuid not null,              -- nullable after customer deleted; kept for audit
  requested_by   uuid,                       -- actor_user_id at time of request
  completed_at   timestamptz not null default now(),
  tables_erased  text[] not null,
  created_at     timestamptz not null default now()
);

alter table erasure_requests enable row level security;

create policy "tenant: select own erasure requests"
  on erasure_requests for select
  using (business_id = get_current_business_id());

-- INSERT policy required: RLS blocks all operations not covered by a policy,
-- even if a GRANT exists. Without this, the DPDP erasure tombstone insert fails.
create policy "tenant: insert own erasure requests"
  on erasure_requests for insert
  with check (business_id = get_current_business_id());

grant select, insert on erasure_requests to authenticated;

-- ── Explicit service_role grants ──────────────────────────────────────────────
-- service_role has BYPASSRLS (skips RLS policies) but still needs table-level
-- GRANT privileges in Supabase local Docker. Without these, any service-role
-- query (budget check, daily cron) hits "permission denied for table X".
grant select, insert, update, delete on businesses         to service_role;
grant select, insert, update, delete on connected_accounts to service_role;
grant select, insert, update, delete on customers          to service_role;
grant select, insert, update, delete on invoices           to service_role;
grant select, insert                  on payments           to service_role;
grant select, insert, update          on briefings          to service_role;
grant select, insert, update          on follow_ups         to service_role;
grant select, insert                  on audit_log          to service_role;
grant select, insert                  on consent_records    to service_role;
grant select, insert                  on llm_usage_log      to service_role;
grant select, insert                  on erasure_requests   to service_role;
grant usage on sequence audit_log_id_seq      to service_role;
grant usage on sequence llm_usage_log_id_seq  to service_role;
