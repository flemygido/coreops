# CoreOps — PROGRESS.md

Living progress tracker. Updated at the end of every phase. Read this alongside CLAUDE.md at the start of every session.

---

## Current Phase

**Phase 3 — Integration Connectors** | Status: **COMPLETE** (awaiting owner approval — see Decisions Awaiting Approval)

---

## Process Note: Branch Strategy Deviation (Phases 0-2)

> ⚠️ Phases 0, 1, and 2 were committed and pushed directly to `main`, contradicting the Branch Strategy convention in CLAUDE.md (`main` should require CI + no direct pushes; phase work should go through `feat/phase-N-<name>` branches with a PR). This was caught by a permission check during Phase 3, not by process discipline.
>
> **Resolution (2026-06-16):** From Phase 3 onward, all phase work goes through a `feat/phase-N-<name>` branch, opened as a PR, and merged after CI passes. Phases 0-2 are not being retroactively rebranched — they are accepted as-is on `main`.

---

## Process Note: Auth Layer Never Verified a Real Token (Phase 2 bug, found in Phase 3)

> ⚠️ Phase 2's auth plugin (`apps/api/src/plugins/auth.ts`) configured `@fastify/jwt` to verify Supabase tokens with a static HS256 `SUPABASE_JWT_SECRET`. Real Supabase access tokens are signed **ES256** with rotating, `kid`-identified asymmetric keys — a static HS256 secret can never verify them. Every Phase 2 test suite passed regardless: `api.integration.test.ts` only checked the 401-without-token path, and `rls.integration.test.ts` bypasses the Fastify app entirely (calls `supabase-js` directly). The bug was only caught when `connected-accounts.integration.test.ts` (Phase 3) was run against live local Supabase with a real signed-in user.
>
> **Fix (2026-06-16):** `auth.ts` now verifies via `supabase-js`'s `auth.getClaims(token)`, which fetches and caches the project's JWKS and verifies locally via WebCrypto — see [ADR-0003 Amendment](./docs/adr/ADR-0003-api-auth.md#amendment-2026-06-16). `@fastify/jwt` and `SUPABASE_JWT_SECRET` were removed entirely (no longer needed). A second latent bug surfaced once auth started succeeding: `req.supabase` was decorated as a getter-only accessor, so assigning it on a real request threw `TypeError: ... has only a getter` — fixed by decorating with a plain default value instead.
>
> **Verification:** re-ran the full suite (52 tests) against live local Supabase — all pass, including the previously-only-smoke-tested authenticated path with a real user and real RLS-scoped queries.
>
> **Lesson:** a green test suite that only exercises the _rejection_ path of an auth layer says nothing about whether the _acceptance_ path works. Any future auth-adjacent change must be verified against a live identity provider, not just unit/mocked tests.

---

## Phase History

| Phase | Status   | Date       | Commit                                       |
| ----- | -------- | ---------- | -------------------------------------------- |
| 0     | COMPLETE | 2026-06-15 | f1e446d                                      |
| 1     | COMPLETE | 2026-06-15 | 9e9ab41                                      |
| 2     | COMPLETE | 2026-06-16 | 558c690                                      |
| 3     | COMPLETE | 2026-06-16 | pending PR merge (`feat/phase-3-connectors`) |

---

## Phase 3 Checklist ✅

### Prerequisite Research

- [x] Zoho Books API v3 — REST, OAuth2, `organization_id`, 100 req/min rate limit
- [x] Tally Prime integration options — **no cloud API**; only local XML-over-HTTP/ODBC on the customer's LAN (architectural finding, see ADR-0004)
- [x] WhatsApp Business Cloud API — template messages required outside the 24h customer-service window (ties to existing CLAUDE.md WhatsApp pricing rule)
- [x] `croner` vs `node-cron` for future Phase 5 orchestration — `croner` chosen (research note only, not installed; see ADR-0004)
- [x] Supabase JWT signing — discovered ES256/JWKS (not static HS256 secret); see Process Note above

### Connector Abstraction

- [x] `apps/api/src/connectors/types.ts` — `AccountingConnector` / `MessagingConnector` interfaces, DTOs, provider lists
- [x] `apps/api/src/connectors/registry.ts` — `getAccountingConnector` / `getMessagingConnector` factories, `isAccountingProvider` / `isMessagingProvider` guards
- [x] `apps/api/src/connectors/mocks/zoho-books.mock.ts`, `tally.mock.ts`, `google-sheets.mock.ts`, `whatsapp.mock.ts`, `gmail.mock.ts` — deterministic, referentially-consistent mock data; no real network calls (Phase 4/5 scope)
- [x] `apps/api/src/routes/connected-accounts.ts` — CRUD routes: list, create (encrypt + 409 on duplicate provider), delete, `/test` (decrypt + connector dispatch)

### Auth Fix (found during Phase 3 testing, root cause was Phase 2)

- [x] `apps/api/src/plugins/auth.ts` — JWKS-based verification via `supabase-js getClaims()`; removed `@fastify/jwt` and `SUPABASE_JWT_SECRET` entirely
- [x] Fixed `req.supabase` getter-only decorator bug (only surfaced once auth started succeeding)
- [x] `docs/adr/ADR-0003-api-auth.md` — amended to document the corrected approach

### Tests

- [x] `apps/api/src/connectors/__tests__/mocks.test.ts` — all 5 mock connectors: testConnection pass/fail, deterministic data, referential consistency
- [x] `apps/api/src/connectors/__tests__/registry.test.ts` — provider classification + factory correctness
- [x] `apps/api/src/__tests__/connected-accounts.integration.test.ts` — full route path (create → list → test → delete) against live local Supabase with a real signed-in user
- [x] `apps/api/src/__tests__/api.integration.test.ts` — updated for the 4 new connected-accounts routes; fixed a Fastify-lifecycle bug (body-schema validation runs before `preHandler`, so protected POST/DELETE routes need a valid payload to actually hit the 401 check instead of a 400)

### All Checks

- [x] `npm run lint` — zero errors
- [x] `npm run type-check` — zero errors (both workspaces)
- [x] `npm test` — 52 passed, 0 skipped, against live local Supabase (mocked-env run: 42 passed, 10 skipped — Supabase-gated tests correctly skip without `SUPABASE_URL` etc.)
- [x] `docs/adr/ADR-0004-connectors.md` — written: connector abstraction design, Tally relay-agent finding, croner orchestration decision

---

## Phase 2 Checklist ✅

### Core Infrastructure

- [x] `apps/api/src/env.ts` — strict env validation; fail-fast on missing vars
- [x] `apps/api/src/types/fastify.d.ts` — TypeScript module augmentation (env, supabaseAdmin, businessId, supabase on request)
- [x] `apps/api/src/plugins/errors.ts` — centralised error handler; AppError hierarchy (404/401/400/409)
- [x] `apps/api/src/plugins/supabase-admin.ts` — service-role client (never exposed to user routes)
- [x] `apps/api/src/plugins/auth.ts` — verifies Supabase JWT via JWKS (`getClaims`); per-request RLS client; businessId decorated (see Process Note: Auth Layer bug, fixed 2026-06-16)
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

| #   | Question / Blocker                                                           | Priority | Status                                                                                                                                              |
| --- | ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **RISK #1:** No confirmed paying customer — strategy is "publish to attract" | High     | Open — blocks Phase 7 only                                                                                                                          |
| 2   | Does the pilot use Zoho Books or Tally?                                      | High     | **Resolved 2026-06-16 — Zoho Books.** Tally relay-agent work (ADR-0004) is deprioritized; only build it if a Tally-only customer later requires it. |
| 3   | RLS integration test needs SUPABASE_URL in CI secrets (Phase 7 work)         | Medium   | Noted — CI job will skip until secrets added                                                                                                        |

---

## Decisions Awaiting Approval

| #   | Decision                                                                                                                                                            | Status                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Phase 2 complete — auth, 6 route files, receivables state service, 42 tests passing                                                                                 | Approved — Phase 3 started                                    |
| 2   | Phase 3 complete — connector abstraction + 5 mocks, connected-accounts CRUD, JWKS auth fix, ADR-0004; on branch `feat/phase-3-connectors`, not yet merged to `main` | **Awaiting owner approval to open PR / merge before Phase 4** |
