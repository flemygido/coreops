-- CoreOps — Row Level Security
-- Phase 1: Tenant isolation via RLS on every table.
-- A user can ONLY see/modify rows belonging to their business.

-- ── Helper: resolve authenticated user's business_id ────────────────────────
-- security definer: runs with privileges of the function owner, not the caller.
-- stable: result is constant within a single query — Postgres may cache it.
create or replace function get_current_business_id()
returns uuid
language sql stable security definer
as $$
  select id from businesses where owner_user_id = auth.uid() limit 1;
$$;

-- ── Enable RLS on all tables ─────────────────────────────────────────────────
alter table businesses       enable row level security;
alter table connected_accounts enable row level security;
alter table customers        enable row level security;
alter table invoices         enable row level security;
alter table payments         enable row level security;
alter table briefings        enable row level security;
alter table follow_ups       enable row level security;
alter table audit_log        enable row level security;
alter table consent_records  enable row level security;

-- ── businesses ───────────────────────────────────────────────────────────────
-- Owner can only see and modify their own business row.
create policy "owner: select own business"
  on businesses for select
  using (owner_user_id = auth.uid());

create policy "owner: update own business"
  on businesses for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "owner: insert own business"
  on businesses for insert
  with check (owner_user_id = auth.uid());

-- ── connected_accounts ───────────────────────────────────────────────────────
create policy "tenant: select"
  on connected_accounts for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on connected_accounts for insert
  with check (business_id = get_current_business_id());

create policy "tenant: update"
  on connected_accounts for update
  using (business_id = get_current_business_id())
  with check (business_id = get_current_business_id());

create policy "tenant: delete"
  on connected_accounts for delete
  using (business_id = get_current_business_id());

-- ── customers ────────────────────────────────────────────────────────────────
create policy "tenant: select"
  on customers for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on customers for insert
  with check (business_id = get_current_business_id());

create policy "tenant: update"
  on customers for update
  using (business_id = get_current_business_id())
  with check (business_id = get_current_business_id());

create policy "tenant: delete"
  on customers for delete
  using (business_id = get_current_business_id());

-- ── invoices ─────────────────────────────────────────────────────────────────
create policy "tenant: select"
  on invoices for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on invoices for insert
  with check (business_id = get_current_business_id());

create policy "tenant: update"
  on invoices for update
  using (business_id = get_current_business_id())
  with check (business_id = get_current_business_id());

create policy "tenant: delete"
  on invoices for delete
  using (business_id = get_current_business_id());

-- ── payments ─────────────────────────────────────────────────────────────────
create policy "tenant: select"
  on payments for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on payments for insert
  with check (business_id = get_current_business_id());

-- Payments are immutable — no update/delete policies.

-- ── briefings ────────────────────────────────────────────────────────────────
create policy "tenant: select"
  on briefings for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on briefings for insert
  with check (business_id = get_current_business_id());

create policy "tenant: update"
  on briefings for update
  using (business_id = get_current_business_id())
  with check (business_id = get_current_business_id());

-- ── follow_ups ───────────────────────────────────────────────────────────────
create policy "tenant: select"
  on follow_ups for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on follow_ups for insert
  with check (business_id = get_current_business_id());

create policy "tenant: update"
  on follow_ups for update
  using (business_id = get_current_business_id())
  with check (business_id = get_current_business_id());

-- ── audit_log ────────────────────────────────────────────────────────────────
-- Read-only for tenant users; only service role can insert.
-- System events (business_id null) are never visible to tenants.
create policy "tenant: select own logs"
  on audit_log for select
  using (business_id = get_current_business_id());

-- ── consent_records ──────────────────────────────────────────────────────────
create policy "tenant: select"
  on consent_records for select
  using (business_id = get_current_business_id());

create policy "tenant: insert"
  on consent_records for insert
  with check (business_id = get_current_business_id());

-- Consent records are immutable; use withdrawn_at to record withdrawal.
