-- CoreOps — WhatsApp service-window tracking
-- Phase 6.5: records when a customer last messaged the business number, establishing
-- a 24-hour free service window. Rows are upserted on every inbound webhook event.

create table whatsapp_windows (
  id                bigserial    primary key,
  business_id       uuid         not null references businesses(id) on delete cascade,
  recipient_phone   text         not null check (length(recipient_phone) >= 7),
  window_expires_at timestamptz  not null,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now(),
  unique (business_id, recipient_phone)
);

create trigger trg_whatsapp_windows_updated_at
  before update on whatsapp_windows
  for each row execute function set_updated_at();

alter table whatsapp_windows enable row level security;

-- Authenticated users can check window state for their own business
create policy "tenant: select own windows"
  on whatsapp_windows for select
  using (business_id = get_current_business_id());

-- Service role writes windows from the webhook handler (bypasses RLS)
grant select, insert, update on whatsapp_windows to service_role;
grant select                   on whatsapp_windows to authenticated;
grant usage on sequence whatsapp_windows_id_seq to service_role;
