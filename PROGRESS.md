# CoreOps — PROGRESS.md

Living progress tracker. Updated at the end of every phase. Read this alongside CLAUDE.md at the start of every session.

---

## Current Phase

**Phase 2 — Core Backend & APIs** | Status: **AWAITING OWNER APPROVAL TO START**

---

## Phase History

| Phase | Status   | Date       | Commit         |
| ----- | -------- | ---------- | -------------- |
| 0     | COMPLETE | 2026-06-15 | f1e446d        |
| 1     | COMPLETE | 2026-06-15 | (pending push) |

---

## Phase 1 Checklist ✅

### Prerequisite Research

- [x] Supabase RLS best practices (current)
- [x] Postgres schema patterns for multi-tenant-ready single-tenant
- [x] DPDP Rules 2025 schema requirements (consent, audit)
- [x] Supabase CLI + local Docker setup verified

### Schema & Migrations

- [x] `20260615000001_schema.sql` — 9 tables (businesses, connected_accounts, customers, invoices, payments, briefings, follow_ups, audit_log, consent_records)
- [x] `20260615000002_rls.sql` — RLS enabled on all tables; helper function `get_current_business_id()`
- [x] `20260615000003_indexes.sql` — Performance indexes for receivables query patterns
- [x] `20260615000004_triggers.sql` — `updated_at` auto-update; audit log trigger (strips credentials)
- [x] `20260615000005_grants.sql` — GRANT/REVOKE for `authenticated` and `anon` roles
- [x] All 5 migrations apply cleanly via `supabase db reset`

### TypeScript

- [x] `packages/shared/src/types/schema.ts` — full schema type definitions
- [x] `packages/shared/src/overdue.ts` — deterministic overdue calculator (no LLM)
- [x] `packages/shared/src/__tests__/overdue.test.ts` — 20 unit tests (all edge cases)
- [x] `apps/api/src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt for credentials
- [x] `apps/api/src/__tests__/crypto.test.ts` — 6 crypto unit tests

### Integration Test (RLS isolation)

- [x] `apps/api/src/__tests__/rls.integration.test.ts` — 5 RLS isolation tests
- [x] Test proven: tenant A cannot read tenant B's invoices, customers, or business
- [x] Automatically skipped when SUPABASE_URL is not set (safe in CI without Supabase)

### Seed Data

- [x] `scripts/seed.ts` — TypeScript generator (no real PII)
- [x] `supabase/seed.sql` — generated: 10 customers, 27 invoices, 12 payments, 13 overdue

### All Checks

- [x] `npm run lint` — zero errors
- [x] `npm run type-check` — zero errors (all workspaces)
- [x] `npm test` — 32 tests passed (12 API + 20 shared), 0 failures
- [x] `supabase db reset` — all migrations + seed apply cleanly

---

## Open Questions / Blockers

| #   | Question / Blocker                                                           | Priority | Status                                       |
| --- | ---------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| 1   | **RISK #1:** No confirmed paying customer — strategy is "publish to attract" | High     | Open — blocks Phase 7 only                   |
| 2   | Does the pilot use Zoho Books or Tally? (affects Phase 3 integration scope)  | High     | Awaiting owner input                         |
| 3   | RLS integration test needs SUPABASE_URL in CI secrets (Phase 7 work)         | Medium   | Noted — CI job will skip until secrets added |

---

## Decisions Awaiting Approval

| #   | Decision                                                             | Status                                     |
| --- | -------------------------------------------------------------------- | ------------------------------------------ |
| 1   | Phase 1 complete — schema, RLS, overdue calculator, 32 passing tests | **Awaiting owner approval before Phase 2** |
