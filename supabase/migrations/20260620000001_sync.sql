-- CoreOps — Sync Service
-- Phase 6.6: Unique external-ID constraints enabling idempotent upsert from
-- accounting sources (Zoho Books, Tally, Google Sheets), plus a sync_runs
-- audit table to track every sync attempt per business.

-- ── External-ID uniqueness for idempotent upsert ────────────────────────────
-- Postgres allows multiple NULLs under a UNIQUE constraint (NULL != NULL),
-- so existing seed rows with external_id IS NULL are unaffected.
-- These constraints enable ON CONFLICT (business_id, external_id) DO UPDATE.

alter table customers add constraint uq_customers_business_external
  unique (business_id, external_id);

alter table invoices add constraint uq_invoices_business_external
  unique (business_id, external_id);

alter table payments add constraint uq_payments_business_external
  unique (business_id, external_id);

-- ── sync_runs ────────────────────────────────────────────────────────────────
-- Append-only log of every accounting sync attempt for a business.
-- Records provider, counts, final status, and any error detail.
-- Written by the cron job (service_role); readable by the business owner.
create table sync_runs (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  provider         text not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running' check (
                     status in ('running', 'success', 'partial', 'failed')
                   ),
  customers_synced int not null default 0,
  invoices_synced  int not null default 0,
  payments_synced  int not null default 0,
  error_count      int not null default 0,
  error_detail     jsonb,
  created_at       timestamptz not null default now()
);

alter table sync_runs enable row level security;

-- Tenants may read their own sync run history (useful for dashboard "last synced" display).
create policy "tenant: select own sync runs"
  on sync_runs for select
  using (business_id = get_current_business_id());

-- Only the cron job (service_role) may write sync_runs.
grant select on sync_runs to authenticated;
grant select, insert, update on sync_runs to service_role;

-- Index for "show most recent sync runs for this business" queries.
create index idx_sync_runs_business_started
  on sync_runs(business_id, started_at desc);
