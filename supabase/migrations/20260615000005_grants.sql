-- CoreOps — Role Grants
-- Phase 1: Table-level privileges for Supabase roles.
-- RLS policies (migration 002) restrict WHICH rows; grants here control WHAT operations.
-- The `authenticated` role = any signed-in user. RLS then limits them to their own tenant.

-- authenticated users: full DML on business tables
grant select, insert, update, delete on businesses          to authenticated;
grant select, insert, update, delete on connected_accounts  to authenticated;
grant select, insert, update, delete on customers           to authenticated;
grant select, insert, update, delete on invoices            to authenticated;
grant select, insert                  on payments            to authenticated;
grant select, insert, update          on briefings           to authenticated;
grant select, insert, update          on follow_ups          to authenticated;
grant select                          on audit_log           to authenticated;
grant select, insert                  on consent_records     to authenticated;

-- Sequences (needed for bigserial audit_log.id)
grant usage on sequence audit_log_id_seq to authenticated;

-- anon role: no direct table access (must authenticate first)
revoke all on all tables in schema public from anon;
