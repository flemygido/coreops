# ADR-0008 — Sync Service: live accounting data into Postgres

**Status:** Accepted  
**Phase:** 6.6  
**Date:** 2026-06-20

---

## Context

Up to Phase 6.5, the receivables workflow (`getReceivablesState`, `draftFollowUps`) read from the Postgres tables populated by seed data. The Zoho Books and WhatsApp connectors were live, but there was no mechanism to continuously pull data from Zoho into Postgres. This meant:

- `/v1/receivables/state` always returned seed data, not real customer balances.
- The daily WhatsApp briefing reflected dummy invoices, not actual overdue receivables.
- Any follow-up sent referenced customer data that was not current.

Phase 6.6 closes this gap by adding a **SyncService** that pulls from the accounting connector and upserts into Postgres before every workflow execution.

---

## Decision

### 1. Source-agnostic design — connector interface only

`syncBusiness(adminSupabase, businessId)` calls only the `AccountingConnector` interface (`fetchCustomers`, `fetchInvoices`, `fetchPayments`). It never imports ZohoBooksConnector directly. Adding Tally or Google Sheets support later requires no changes to the sync service.

### 2. UNIQUE constraint for idempotent upsert

```sql
alter table customers add constraint uq_customers_business_external
  unique (business_id, external_id);
alter table invoices  add constraint uq_invoices_business_external
  unique (business_id, external_id);
alter table payments  add constraint uq_payments_business_external
  unique (business_id, external_id);
```

Postgres allows multiple NULLs under UNIQUE constraints, so existing seed rows with `external_id IS NULL` are unaffected. Upserts use `ON CONFLICT (business_id, external_id) DO UPDATE`, making re-running safe and eliminating the need for a prior-state query.

### 3. No hard-delete (KNOWN LIMITATION)

Source-side deletions (e.g. an invoice deleted in Zoho) are **not reflected in Postgres**. A stale invoice with `status: 'open'` could keep appearing in overdue calculations and generating follow-up drafts after it has been deleted from Zoho.

**Mitigation for pilot:** The overdue calculator (`getReceivablesState`) only surfaces invoices with `status IN ('open', 'partial')`. An invoice that is paid or voided in Zoho will be updated (via upsert) to `status: 'paid'` or `'void'` on the next sync, removing it from overdue output. The only unmitigated case is a hard delete from Zoho without a status change — uncommon in Indian SMB practice.

**Revisit before scaling:** Implement a full reconciliation query (compare DB `external_id` set vs. connector response set) and soft-delete anything absent from the source.

### 4. sync_runs audit table

Every sync attempt creates a `sync_runs` row with `status: 'running'` at open and is updated to `'success'`, `'partial'`, or `'failed'` at close. The row stores counts (`customers_synced`, `invoices_synced`, `payments_synced`) and `error_detail: string[]`. This gives:

- Observability: `last_synced_at` on `connected_accounts` is touched after every success/partial.
- Debugging: any partial or failed run has its error list persisted.
- Dashboard: the `sync_runs` select policy (`tenant: select own sync runs`) lets the owner see sync history.

### 5. DPDP-first onboarding via setup-pilot.mts

`scripts/setup-pilot.mts` is the only provisioning path. It requires `--consent-confirmed` by construction — the flag cannot be set programmatically, only explicitly by the operator. Before inserting any credentials it:

1. Creates/finds the Supabase auth user for the owner email.
2. Upserts the business row.
3. Writes a `consent_records` row (DPDP-2025-v1) with `purpose: receivables_recovery_workflow`.
4. Upserts encrypted `zoho_books` and `whatsapp` connected_account rows if the relevant env vars are present.

Connecting to a customer's accounting data without a consent record is **impossible by construction** — the order of operations in the script cannot be reordered.

### 6. Cron and route both sync-before-draft

`syncBusiness()` is called before `draftFollowUps()` in two places:

- `apps/api/src/jobs/daily-workflow.ts` — the 07:00 IST cron job.
- `apps/api/src/routes/workflow.ts` — the `POST /v1/workflow/run` manual trigger.

`syncBusiness()` returns `status: 'skipped'` if no accounting connector is configured; the workflow continues without sync in that case (seed data is used). This is intentional for local dev and unit test environments.

### 7. No /v1/sync route in v1

Sync is intentionally not exposed as an HTTP endpoint. Reasons:

- v1 is single-tenant; the pilot owner does not need to trigger sync manually — the cron and the manual workflow trigger already sync-before-draft.
- An explicit sync endpoint would create a new LLM-cost amplification vector (sync + draft on each call) that isn't needed at this scale.
- If a forced resync is needed during the pilot, the admin can call `syncBusiness()` directly from the cron script or a one-off tsx invocation.

### 8. No incremental sync in v1

Every call to `syncBusiness()` fetches the full page set from Zoho (customers, invoices, payments). Given the pilot scale (tens of customers, hundreds of invoices), full-fetch is cheaper than tracking a delta cursor. Incremental sync (Zoho's `last_modified_time` filter or webhooks) is a post-pilot optimisation.

---

## Consequences

- **Positive:** Live Zoho data appears in `/v1/receivables/state` and follow-up drafts without any additional infrastructure (no webhooks, no ETL pipeline, no message queue).
- **Positive:** Sync is idempotent and audit-logged, so failures are visible and re-runs are safe.
- **Positive:** DPDP consent is structurally enforced at onboarding — no code path exists to skip it.
- **Negative:** Full-fetch cost grows with Zoho record volume; revisit before pilot expands beyond ~500 invoices.
- **Negative:** Stale-record risk from source-side hard-deletes (documented above).
- **Negative:** Token expiry during a sync run fails the entire sync (the connector refreshes once; if refresh also fails, the run is marked `failed`). Monitored via `sync_runs`.
