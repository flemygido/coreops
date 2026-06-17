# CoreOps — Round 1 Validation Log

**Date:** 2026-06-17
**Branch:** feat/phase-5-receivables-workflow
**Services:** API :3000 (tsx watch), Dashboard :3001 (Next.js dev)
**Test user:** owner@coreops.local / CoreOps2026!

---

## Persona Index

| Persona | Role               | Focus                                         |
| ------- | ------------------ | --------------------------------------------- |
| Shreya  | UX Expert          | Task flows, empty states, error feedback      |
| Vikram  | UI Expert          | Visual consistency, typography, responsive    |
| Aditya  | Code Reviewer      | Type safety, logic correctness, test coverage |
| Priya   | SMB Owner          | Real-world usability, plain-English clarity   |
| Meera   | Finance Controller | Data accuracy, audit trail, reconciliation    |
| Hari    | IT / Security      | Auth, credential handling, privacy boundaries |

---

## Round 1 Findings

### Shreya — UX Expert

**[BLOCKER] (Error Feedback) — File: components/FollowUpCard.tsx:79 & components/RunWorkflowButton.tsx:39**
Both components read `body.message` on error, but the Fastify error handler returns `{ error: { code, message } }`. Result: every API error shows as `"Failed: 400"` instead of `"Follow-up must be approved before sending"`. Error messages are completely invisible to the user.

**[BLOCKER] (Error Feedback) — File: components/FollowUpCard.tsx:90-108**
`sendMessage()` only checks `res.ok` (HTTP status). The API can return HTTP 200 with `{ ok: false, message: "..." }` when the connector fails. The current code calls `setCurrentStatus('sent')` unconditionally on HTTP 200. A failed WhatsApp send silently appears as "Sent ✓" to the owner.

**[CONCERN] (Empty State) — Screen: /follow-ups (empty)**
Empty state says "Run the workflow from the Overview page to generate drafts." No direct link or button to the Overview page — the user has to find the nav themselves. Minor, but adds friction on first use.

**[CONCERN] (Loading / Feedback) — Screen: /dashboard**
After clicking "Run workflow", the result toast (`✓ 2 drafted · 0 already pending`) disappears on any page navigation or refresh. The owner has no persistent confirmation that the workflow ran — they must infer it from the follow-ups count changing.

**[POSITIVE] (Validation) — Screen: /login**
Login form uses native `required` + `type="email"` + loading state. Solid baseline.

**[POSITIVE] (Loading State) — File: components/RunWorkflowButton.tsx:59-63**
Spinner + "Drafting follow-ups…" text during the call prevents double-submit. Good.

---

### Vikram — UI Expert

**[CONCERN] (Duplicate Logic) — File: dashboard/page.tsx:12-13 vs packages/shared/src/overdue.ts**
`daysSince()` reimplements overdue logic inline rather than using `calculateOverdue()` from `@coreops/shared`. The bucket labels also differ: dashboard uses `"1–30 days"` (en-dash) but the shared package's `AgeBucket` type uses `"1-30"` (hyphen). Two sources of truth for the same business rule.

**[CONCERN] (Responsive) — File: dashboard/page.tsx:99-154**
The overdue invoices table has 4 columns including a "Days overdue" badge column. On a 375px phone, the table overflows without a horizontal scroll wrapper. Indian SMB owners often access on mobile.

**[CONCERN] (Typography) — File: app/layout.tsx**
No custom font — falls back to system-ui/sans-serif. On Android (common in India), this renders with Roboto, which is fine, but there's no `<meta charset="utf-8" />` or `<meta name="viewport" />` in the layout, relying on Next.js defaults. Fine for now but worth a note.

**[POSITIVE] (Color System) — Files: FollowUpCard.tsx, follow-ups/page.tsx**
Status badge colors are consistent: yellow=draft, blue=approved, green=sent, red=failed, gray=skipped. All use Tailwind semantic color names, not arbitrary hex.

**[POSITIVE] (Layout) — Screen: /dashboard**
Max-width 5xl (1024px) content column on both nav and main — clean reading width without stretching to full ultrawide.

---

### Aditya — Code Reviewer

**[BLOCKER] (API Contract) — File: routes/follow-ups.ts:47-55**
`PATCH /v1/follow-ups/:id/status` accepts `status: 'sent' | 'failed'` via the TypeBox schema. An authenticated user can directly set a follow-up to `sent` without going through `POST /v1/follow-ups/:id/send`, bypassing the WhatsApp send entirely and creating a false audit record. The PATCH endpoint should only accept `approved` and `skipped`.

**[CONCERN] (Error Handling) — File: routes/workflow.ts:78**
`if (error) throw new Error(error.message)` converts a Supabase error into an untyped `Error`, causing the error handler to return a generic 500. Should be a typed `AppError` (e.g., `throw new AppError(500, 'DB_ERROR', error.message)`). Lost context at the API boundary.

**[CONCERN] (Dynamic Import in Hot Path) — File: services/send-follow-up.ts:85**
`await import('../connectors/mocks/whatsapp.mock.js')` inside the function body. Node.js caches after first load, so no perf risk, but it makes the mock impossible to stub in unit tests without intercepting the dynamic import. Prefer a top-level import (or pass the connector as a parameter for testability).

**[CONCERN] (Rate Limiting) — File: routes/workflow.ts:35-54**
No rate limiting on `POST /v1/workflow/run`. An authenticated user can hammer this endpoint. Each call iterates all overdue invoices and makes one LLM call per un-drafted invoice. With 50 overdue invoices and gpt-5-mini, that's ~50 LLM calls per button press. Phase 6 must add rate limiting here (recommend: 1 call per business per 5 minutes).

**[CONCERN] (Admin Client Scope) — File: jobs/daily-workflow.ts:40**
`draftFollowUps(admin, admin, biz.id, llm)` passes the service-role admin client as both the RLS-scoped `supabase` arg and the admin arg. The filter `.eq('business_id', businessId)` in `draft-follow-ups.ts:35` is an explicit filter rather than an RLS policy check — it works, but a single typo in that filter would expose all businesses' data. The per-request pattern in the manual trigger is safer: user-scoped client for reads, admin only for `llm_usage_log` writes.

**[CONCERN] (Guardrail Fragility) — File: llm/guardrails.ts:34-38**
`!trimmed.includes(input.customer_name)` — strict substring check on the full name. If a customer is named "Rajesh Kumar Sharma" and the LLM writes "Dear Rajesh Kumar", the guardrail throws. Also: `.includes()` is case-sensitive. If the LLM capitalizes differently, the draft fails silently (error caught in `draft-follow-ups.ts:68-74`, invoice goes to `failed++` with no DB record).

**[POSITIVE] (Idempotency) — File: services/draft-follow-ups.ts:32-38**
Existing follow-ups are fetched in a single IN query before the loop — no N+1 problem, and re-running the workflow never creates duplicates. Solid.

**[POSITIVE] (Privacy Boundary) — File: llm/redact.ts**
Allowlist approach (explicit field selection) rather than regex stripping. Phone, email, customer_id never reach the LLM prompt. Right call given structured inputs.

**[POSITIVE] (croner protect:true) — File: jobs/daily-workflow.ts:20**
`protect: true` prevents overlapping cron runs if a prior run is still in-flight. Critical for a job that makes external LLM calls.

---

### Priya — SMB Owner

**[CONCERN] (Setup Friction) — Screen: N/A (onboarding)**
There is no self-serve onboarding. To use the platform, the owner currently needs: (1) a developer to run `scripts/create-owner.mts`, (2) a developer to run `scripts/seed.ts` to add sample invoices. The dashboard shows "No overdue invoices" or "No business found" with no guidance. Not a blocker for the pilot (it's single-tenant and dev-assisted), but needs a note in the pilot runbook.

**[CONCERN] (Message Preview) — Screen: /follow-ups**
The drafted WhatsApp message is shown in a gray box without any indication of how it will arrive on the customer's phone. A WhatsApp Business message has a sender name, a template category, and formatting. The owner is approving "plain text" but has no mental model of how it will look. Consider a WhatsApp-style bubble mock.

**[CONCERN] (No Undo on Skip) — Screen: /follow-ups**
Clicking "Skip" immediately changes status. There is no confirmation, no undo. If the owner accidentally skips, the invoice disappears from the active queue. A skipped invoice does NOT re-appear unless the workflow is re-run (which creates a new draft since `skipped` is excluded from the idempotency check). This is actually intentional but surprising — needs a tooltip or undo window.

**[POSITIVE] (Customer Context) — File: components/FollowUpCard.tsx:128-129**
The follow-up card shows `{invoiceNumber} · {formatRupees(outstanding)} · {customerPhone}` inline. The owner sees exactly which customer, which invoice, and the phone number before approving. Good.

**[POSITIVE] (INR Formatting) — File: components/FollowUpCard.tsx:28-34**
`Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })` formats ₹ correctly with Indian number grouping (1,00,000 not 100,000). Correct locale.

---

### Meera — Finance Controller

**[POSITIVE] (Dashboard Status Filter) — File: dashboard/page.tsx:35-40**
Dashboard query uses `.in('status', ['open', 'partial'])` at the DB level — `paid`, `void`, and `written_off` invoices are excluded before the overdue filter runs. Payment sync lag cannot cause a void invoice to appear overdue. Added an explanatory comment to make the intent explicit for future readers.

**[CONCERN] (DSO Not Displayed) — Screen: /dashboard**
CLAUDE.md and the MVP success metric centre on reducing DSO (Days Sales Outstanding). The dashboard shows total overdue amount and bucket counts — but not DSO itself. DSO = (AR ÷ Credit Sales) × Days. Without total credit sales data, DSO can't be computed from current schema alone, but at minimum the current AR/overdue metric should be labelled as a proxy. Phase 6 should add DSO tracking.

**[CONCERN] (LLM Cost Not Visible) — Screen: /dashboard**
`llm_usage_log` tracks all AI spend per business, including `cost_usd`. None of this is visible in the dashboard. For a finance controller, AI cost is a line item they need to see. The data is there; it just needs a UI widget.

**[POSITIVE] (UTC-Correct Overdue Math) — File: packages/shared/src/overdue.ts:136-144**
`parseDateUTC` and `startOfDayUTC` ensure day-granularity calculations are timezone-independent. The shared package is the single source of truth for overdue logic, and the API's `receivables-state.ts` uses it correctly.

**[POSITIVE] (Immutable Payments) — File: supabase/migrations/20260615000002_rls.sql:104**
`payments` table has no UPDATE or DELETE policy — payments can only be inserted. Prevents retroactive payment record manipulation.

---

### Hari — IT / Security

**[CONCERN] (Helmet vs CSP) — File: apps/api/src/app.ts:22**
`helmet` is registered with default settings. Fastify's `@fastify/helmet` v12+ defaults no longer include Content-Security-Policy by default — verify the headers being sent: `curl -I http://localhost:3000/health | grep -i security`. Without explicit CSP configuration, the API's JSON responses aren't at risk, but noting the default has changed.

**[CONCERN] (Admin Client for All Businesses in Cron) — File: jobs/daily-workflow.ts:32-40**
Service-role key bypasses all RLS. If a bug in `draftFollowUps` corrupts the `businessId` filter, it operates on ALL tenants' data without a safety net. The manual `/v1/workflow/run` endpoint uses a user-scoped JWT for reads — the cron should do the same (mint short-lived JWTs per business, or at minimum scope with PostgREST `apikey` + set `role = anon` after selecting business id).

**[CONCERN] (No Refresh Token Expiry Handling) — File: components/FollowUpCard.tsx:58-64**
`supabase.auth.getSession()` returns the cached session without re-validating against the server. If the session has expired between the server render and the client action, the API call returns 401 with "Invalid or expired token" — but the error is shown as "Failed: 401" (pre-fix) or "Invalid or expired token" (post-fix). There's no auto-redirect to /login on 401.

**[POSITIVE] (JWKS-based JWT Verification) — File: plugins/auth.ts:33**
`client.auth.getClaims(token)` uses Supabase's JWKS verification (cached, ES256) instead of a static HS256 secret. Rotating keys are handled automatically. Right call.

**[POSITIVE] (Encryption at Rest) — File: lib/crypto.ts (not read, but referenced)**
`credentials_encrypted` in `connected_accounts` uses AES-256-GCM. The `ENCRYPTION_KEY` is loaded from env (not hardcoded). The `send-follow-up.ts:95` correctly decrypts before use.

**[POSITIVE] (Privacy: No Phone in Prompt) — File: llm/redact.ts:14-23**
Customer phone number is excluded from the allowlist — it never reaches the LLM. Only `customer_name`, `invoice_number`, `amount_outstanding`, `currency`, `days_overdue` are sent. Correct.

**[POSITIVE] (RLS on llm_usage_log) — File: supabase/migrations/20260616000001_llm_usage_log.sql:19-27**
RLS enabled; tenants can only SELECT their own rows; INSERT is service-role only (no grant to authenticated). Cost data is private per tenant.

---

## Priority Matrix

| #   | Finding                                                               | Severity | Fix In    |
| --- | --------------------------------------------------------------------- | -------- | --------- |
| 1   | Error field mismatch: body.message vs body.error.message              | BLOCKER  | This pass |
| 2   | Send failure silently shows as Sent                                   | BLOCKER  | This pass |
| 3   | PATCH /status allows 'sent'/'failed' direct write                     | BLOCKER  | This pass |
| 4   | Dashboard status filter — already correct at DB level (added comment) | POSITIVE | Done      |
| 5   | 401 from client-side fetch never redirects to /login                  | CONCERN  | Phase 6   |
| 6   | No rate limiting on /v1/workflow/run                                  | CONCERN  | Phase 6   |
| 7   | Dynamic import of mock connector in send-follow-up.ts                 | CONCERN  | Phase 6   |
| 8   | Guardrail customer name case-sensitive include                        | CONCERN  | Phase 6   |
| 9   | DSO metric not displayed                                              | CONCERN  | Phase 6   |
| 10  | LLM cost not visible in dashboard                                     | CONCERN  | Phase 6   |

---

## Fixes Applied This Pass

- [x] Fix #1: `body.error?.message` in FollowUpCard + RunWorkflowButton
- [x] Fix #2: Check `data.ok` after HTTP 200 in sendMessage()
- [x] Fix #3: Restrict PATCH /status to `approved` | `skipped` only
- [x] Fix #4: Add `force-dynamic` to dashboard page; confirmed existing DB-level status filter is correct (added clarifying comment)

---

_Next: Round 2 after Phase 6 (observability, rate limiting, DPDP hardening)._
