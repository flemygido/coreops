-- CoreOps — Triggers
-- Phase 1: Auto-update updated_at; auto-log to audit_log.

-- ── updated_at trigger ───────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_businesses_updated_at
  before update on businesses
  for each row execute function set_updated_at();

create trigger trg_connected_accounts_updated_at
  before update on connected_accounts
  for each row execute function set_updated_at();

create trigger trg_customers_updated_at
  before update on customers
  for each row execute function set_updated_at();

create trigger trg_invoices_updated_at
  before update on invoices
  for each row execute function set_updated_at();

create trigger trg_follow_ups_updated_at
  before update on follow_ups
  for each row execute function set_updated_at();

-- ── audit_log trigger ────────────────────────────────────────────────────────
-- Automatically records every INSERT/UPDATE/DELETE on key tables.
-- Strips credentials_encrypted from connected_accounts to avoid logging secrets.
create or replace function audit_log_trigger()
returns trigger language plpgsql security definer as $$
declare
  old_data jsonb := null;
  new_data jsonb := null;
  bid      uuid  := null;
begin
  if TG_OP = 'DELETE' then
    old_data := to_jsonb(old);
    bid      := old.business_id;
  elsif TG_OP = 'UPDATE' then
    old_data := to_jsonb(old);
    new_data := to_jsonb(new);
    bid      := new.business_id;
  else
    new_data := to_jsonb(new);
    bid      := new.business_id;
  end if;

  -- Redact encrypted credentials from audit records
  if TG_TABLE_NAME = 'connected_accounts' then
    old_data := old_data - 'credentials_encrypted';
    new_data := new_data - 'credentials_encrypted';
  end if;

  insert into audit_log(business_id, actor_user_id, action, table_name, record_id, old_data, new_data)
  values (
    bid,
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    case
      when TG_OP = 'DELETE' then (old_data->>'id')::uuid
      else (new_data->>'id')::uuid
    end,
    old_data,
    new_data
  );

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Apply audit trigger to tables that matter for compliance
create trigger trg_audit_invoices
  after insert or update or delete on invoices
  for each row execute function audit_log_trigger();

create trigger trg_audit_payments
  after insert on payments
  for each row execute function audit_log_trigger();

create trigger trg_audit_follow_ups
  after insert or update on follow_ups
  for each row execute function audit_log_trigger();

create trigger trg_audit_consent_records
  after insert or update on consent_records
  for each row execute function audit_log_trigger();
