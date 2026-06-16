-- CoreOps — LLM Usage Log
-- Phase 4: cost tracking for every LLM call (follow-up drafts, briefing summaries).
-- Append-only, like audit_log. Written by the API process itself, never by a user
-- action directly, so RLS only needs to grant tenants read access to their own rows.

create table llm_usage_log (
  id            bigserial primary key,
  business_id   uuid not null references businesses(id) on delete cascade,
  purpose       text not null check (purpose in ('follow_up_draft', 'briefing_summary')),
  model         text not null,
  input_tokens  int not null,
  output_tokens int not null,
  cost_usd      numeric(10, 6) not null,
  created_at    timestamptz not null default now()
);

create index idx_llm_usage_log_business_id on llm_usage_log(business_id, created_at desc);

alter table llm_usage_log enable row level security;

create policy "tenant: select own usage"
  on llm_usage_log for select
  using (business_id = get_current_business_id());

-- Tenants can read their own usage but never write it directly — only the API
-- process (service role, which bypasses RLS/grants entirely) logs usage, right
-- after the LLM call it's billed for. No insert/update/delete grant needed here.
grant select on llm_usage_log to authenticated;
