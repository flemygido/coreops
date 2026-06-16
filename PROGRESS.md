# CoreOps — PROGRESS.md

Living progress tracker. Updated at the end of every phase. Read this alongside CLAUDE.md at the start of every session.

---

## Current Phase

**Phase 3 — Integration Connectors** | Status: **AWAITING OWNER APPROVAL TO START**

---

## Phase History

| Phase | Status   | Date       | Commit         |
| ----- | -------- | ---------- | -------------- |
| 0     | COMPLETE | 2026-06-15 | f1e446d        |
| 1     | COMPLETE | 2026-06-15 | 9e9ab41        |
| 2     | COMPLETE | 2026-06-16 | (pending push) |

---

## Phase 2 Checklist ✅

### Core Infrastructure

- [x] `apps/api/src/env.ts` — strict env validation; fail-fast on missing vars
- [x] `apps/api/src/types/fastify.d.ts` — TypeScript module augmentation (env, supabaseAdmin, businessId, supabase on request)
- [x] `apps/api/src/plugins/errors.ts` — centralised error handler; AppError hierarchy (404/401/400/409)
- [x] `apps/api/src/plugins/supabase-admin.ts` — service-role client (never exposed to user routes)
- [x] `apps/api/src/plugins/auth.ts` — @fastify/jwt verifies Supabase JWT; per-request RLS client; businessId decorated
- [x] `apps/api/src/app.ts` — Fastify app factory (plugins + routes registered in correct order)
- [x] `apps/api/src/server.ts` — entry point: loadEnv + createApp + listen

### Route Handlers (all authenticated, schema-validated with TypeBox)

- [x] `apps/api/src/routes/health.ts` — `GET /health` (open, no auth)
- [x] `apps/api/src/routes/invoices.ts` — `GET /v1/invoices`, `GET /v1/invoices/:id`
- [x] `apps/api/src/routes/customers.ts` — `GET /v1/customers`, `GET /v1/customers/:id`
- [x] `apps/api/src/routes/briefings.ts` — `GET /v1/briefings`, `GET /v1/briefings/:id`, `POST /v1/briefings` (day-idempotent)
- [x] `apps/api/src/routes/follow-ups.ts` — `GET /v1/follow-ups`, `PATCH /v1/follow-ups/:id/status`
- [x] `apps/api/src/routes/receivables.ts` — `GET /v1/receivables/state`

### Services

- [x] `apps/api/src/services/receivables-state.ts` — assembles overdue snapshot from DB; runs deterministic calculator; returns typed state object for Phase 4 LLM use

### Tests

- [x] `apps/api/src/__tests__/health.test.ts` — 2 contract tests (200 shape, no auth required)
- [x] `apps/api/src/__tests__/receivables-state.test.ts` — 6 unit tests (mocked Supabase): zero invoices, overdue classification, paid exclusion, sort order, missing customer fallback, metadata
- [x] `apps/api/src/__tests__/api.integration.test.ts` — 8 tests proving every protected route returns 401 without token; malformed JWT rejected

### Build & Types

- [x] `packages/shared/tsconfig.build.json` — emit-enabled build config for shared package (dist/)
- [x] All checks green: lint (0 errors), type-check (0 errors, both workspaces), tests (42 passed, 5 skipped = RLS needs live Supabase)

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

| #   | Decision                                                                            | Status                                     |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | Phase 2 complete — auth, 6 route files, receivables state service, 42 tests passing | **Awaiting owner approval before Phase 3** |
