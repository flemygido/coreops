-- CoreOps — DSO & Recovery Metric Snapshots
-- Phase 6.5 (step 4 of gap-close): weekly pilot success-measure tracking.
-- DSO = (Accounts Receivable ÷ Credit Sales over last 30 days) × 30 days.
-- rupees_recovered = invoice amounts fully paid after a CoreOps follow-up was sent.

create table dso_snapshots (
  id                  bigserial primary key,
  business_id         uuid not null references businesses(id) on delete cascade,
  snapshot_date       date not null,
  accounts_receivable numeric(14, 2) not null default 0,
  credit_sales_30d    numeric(14, 2) not null default 0,
  dso_days            numeric(8, 2),          -- null when credit_sales_30d = 0
  rupees_recovered    numeric(14, 2) not null default 0,
  follow_ups_sent     integer not null default 0,
  created_at          timestamptz not null default now(),
  unique (business_id, snapshot_date)
);

alter table dso_snapshots enable row level security;

create policy "tenant: select own dso snapshots"
  on dso_snapshots for select
  using (business_id = get_current_business_id());

-- Only the weekly cron (service role) writes snapshots; authenticated users read.
grant select on dso_snapshots to authenticated;
grant select, insert, update on dso_snapshots to service_role;
grant usage on sequence dso_snapshots_id_seq to service_role;
