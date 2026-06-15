-- CoreOps — Initial Schema
-- Phase 1: Receivables recovery data model
-- Multi-tenant-ready: every table has business_id; RLS enforces isolation.

-- ── businesses ──────────────────────────────────────────────────────────────
create table businesses (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  owner_phone     text,
  gstin           text,                                -- Indian GST registration
  timezone        text not null default 'Asia/Kolkata',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(owner_user_id)
);

-- ── connected_accounts ──────────────────────────────────────────────────────
-- Stores integration credentials encrypted at the application layer.
-- `metadata` holds non-sensitive config (org IDs, phone number IDs, etc.)
create table connected_accounts (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references businesses(id) on delete cascade,
  provider              text not null check (provider in
                          ('zoho_books', 'tally', 'whatsapp', 'gmail', 'google_sheets')),
  credentials_encrypted text,                          -- AES-256-GCM blob
  metadata              jsonb not null default '{}',
  is_active             boolean not null default true,
  last_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(business_id, provider)
);

-- ── customers ───────────────────────────────────────────────────────────────
create table customers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  external_id  text,                                   -- Zoho/Tally record ID
  name         text not null,
  phone        text,
  email        text,
  credit_limit numeric(15, 2),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── invoices ────────────────────────────────────────────────────────────────
create table invoices (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  customer_id    uuid not null references customers(id) on delete restrict,
  external_id    text,                                 -- Zoho/Tally invoice ID
  invoice_number text not null,
  amount         numeric(15, 2) not null check (amount >= 0),
  amount_paid    numeric(15, 2) not null default 0 check (amount_paid >= 0),
  currency       text not null default 'INR',
  issue_date     date not null,
  due_date       date not null,
  status         text not null default 'open' check (
                   status in ('open', 'partial', 'paid', 'void', 'written_off')
                 ),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (amount_paid <= amount * 1.1)                 -- allow small overpayment rounding
);

-- ── payments ────────────────────────────────────────────────────────────────
-- amount can be negative (credit notes / reversals)
create table payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses(id) on delete cascade,
  invoice_id     uuid not null references invoices(id) on delete restrict,
  external_id    text,
  amount         numeric(15, 2) not null,
  paid_at        timestamptz not null,
  payment_method text,
  reference      text,
  notes          text,
  created_at     timestamptz not null default now()
);

-- ── briefings ───────────────────────────────────────────────────────────────
create table briefings (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  generated_at    timestamptz not null default now(),
  sent_at         timestamptz,
  status          text not null default 'draft' check (
                    status in ('draft', 'sent', 'failed')
                  ),
  summary_text    text,
  content_json    jsonb not null default '{}',
  total_overdue   numeric(15, 2),
  invoice_count   int
);

-- ── follow_ups ──────────────────────────────────────────────────────────────
create table follow_ups (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references businesses(id) on delete cascade,
  briefing_id          uuid references briefings(id) on delete set null,
  invoice_id           uuid not null references invoices(id) on delete cascade,
  customer_id          uuid not null references customers(id) on delete cascade,
  drafted_text         text not null,
  status               text not null default 'draft' check (
                         status in ('draft', 'approved', 'sent', 'failed', 'skipped')
                       ),
  approved_at          timestamptz,
  sent_at              timestamptz,
  whatsapp_message_id  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Append-only. Never update or delete rows. business_id nullable for system events.
create table audit_log (
  id              bigserial primary key,
  business_id     uuid references businesses(id) on delete set null,
  actor_user_id   uuid,
  action          text not null,
  table_name      text,
  record_id       uuid,
  old_data        jsonb,
  new_data        jsonb,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);

-- ── consent_records (DPDP) ──────────────────────────────────────────────────
-- Records consent given/withdrawn for data processing.
-- Required by India's DPDP Rules 2025.
create table consent_records (
  id                        uuid primary key default gen_random_uuid(),
  business_id               uuid not null references businesses(id) on delete cascade,
  data_principal_type       text not null check (
                              data_principal_type in ('business_owner', 'customer')
                            ),
  data_principal_id         uuid,                     -- null if external
  data_principal_identifier text,                     -- phone or email
  purpose                   text not null,
  given_at                  timestamptz not null default now(),
  withdrawn_at              timestamptz,
  ip_address                inet,
  consent_version           text not null,
  created_at                timestamptz not null default now()
);
