# CoreOps — CLAUDE.md

**Source of truth for all Claude Code sessions.**
At the start of every session: read this file and PROGRESS.md before doing anything else. State that you have.

---

## Project Overview

CoreOps is an AI operations layer for Indian SMBs. It connects the tools a business already uses (WhatsApp, Gmail, Zoho, Tally, Google Sheets), reads across them, and delivers a daily WhatsApp briefing plus an owner dashboard. It is **NOT a customer-facing chatbot** — it faces the **OWNER**, internally.

**Core principle (the trust moat):** The customer's raw data stays under their control. CoreOps processes privately and surfaces INSIGHTS, not raw client lists. Every architectural decision from schema upward must enforce this boundary. Never retrofit it.

---

## LOCKED WEDGE (Phase 0 — confirmed 2026-06-15)

### 1. The One Buyer

Indian wholesaler/distributor (5–50 staff) who runs orders over WhatsApp and books in Zoho Books or Tally.

### 2. The One Money-Bleed Workflow (v1)

Receivables recovery — detect overdue invoices, match them to the right customer, and prompt the owner with a ready-to-send WhatsApp follow-up.
The rupee problem: money already earned, stuck in delayed payments.

### 3. The Single MVP Success Metric

Reduction in **Days Sales Outstanding (DSO)** OR **rupees of overdue receivables recovered** within a 30-day pilot.

**How measured:**

- Baseline DSO captured before go-live (from existing invoice/payment data in Zoho/Tally)
- DSO = (Accounts Receivable ÷ Total Credit Sales) × Number of Days — recalculated weekly after go-live
- Rupees recovered = sum of invoices that moved from overdue to paid after a CoreOps follow-up was sent
- Baseline source: pilot customer's Zoho Books or Tally export

### 4. Validation Status

> ⚠️ **RISK #1: As of Phase 0 (2026-06-15), there is NO confirmed paying customer.**
> **Strategy chosen by owner:** Publish the project openly on GitHub to attract early customers, rather than waiting for a named pilot before building.
> This changes the risk posture: we are building in public, so code quality, documentation, and security hygiene are customer-facing from Phase 0.
> Phase 7 (pilot deployment) still requires a named customer with DPDP consent before any real data is processed.
> When a pilot is confirmed, record here: **Pilot customer name:** **\*\*\*\***\_**\*\*\*\*** **Pain confirmed:** **\*\*\*\***\_**\*\*\*\*** **Date:** **\*\*\*\***\_**\*\*\*\***

### 5. Non-Goals for v1 (explicitly NOT building)

- Multi-channel marketing
- Customer-facing chatbot
- Inventory optimisation
- Generic "ask anything" assistant
- Multi-language NLU beyond what the receivables workflow needs
- Mobile app
- Multi-tenant management UI (v1 is **single-tenant**; schema is **multi-tenant-ready**)

---

## Confirmed Tech Stack

| Layer               | Choice                                    | Version              | Rationale                                                                                 |
| ------------------- | ----------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| Runtime             | Node.js                                   | 24 LTS (v24.15.0)    | Active LTS until April 2028; stable foundation                                            |
| Language            | TypeScript                                | ^5.x (strict)        | Type safety; same language across API and dashboard                                       |
| API framework       | Fastify                                   | ^5.8.5               | Native TS generics; 3× Express throughput; schema-first validation; JSON Schema → OpenAPI |
| DB / Auth / Storage | Supabase (Postgres + RLS + Auth)          | supabase-js ^2.108.1 | RLS enforces the data-isolation trust moat at DB level; auth built in                     |
| Dashboard           | Next.js + Tailwind                        | Latest               | React Server Components; same TS ecosystem; large Indian hiring pool                      |
| Test runner         | Vitest                                    | ^3.0.0               | Fast; native ESM/TS; no Babel required                                                    |
| Monorepo            | npm workspaces                            | built-in             | Zero extra tooling at v1 scale                                                            |
| LLM                 | Anthropic Claude (provider-abstracted)    | Latest               | Cost/quality for structured output; provider interface prevents lock-in                   |
| WhatsApp            | WhatsApp Business Cloud API (Meta direct) | —                    | Only path for programmatic WhatsApp in India; no BSP markup                               |
| Orchestration       | TypeScript cron jobs (v1)                 | —                    | Full type safety; no extra runtime; n8n deferred (see ADR-0004)                           |

### WhatsApp Pricing Architecture Rule (MANDATORY)

As of **1 July 2025**, billing is **per-message by template category** (not per conversation):

- Marketing templates: ~₹0.82/msg in India (~$0.0094)
- Utility templates inside Customer Service Window (CSW): **FREE**
- Service replies inside 24-hour customer service window: **FREE**
- **Rule:** All routine owner briefings MUST ride free utility/service windows. NEVER depend on paid marketing templates for operational messages.

---

## Phase Map

| Phase | Status      | One-Line Objective                                         |
| ----- | ----------- | ---------------------------------------------------------- |
| 0     | COMPLETE    | Lock the wedge; stand up CI-green empty repo               |
| 1     | COMPLETE    | Model receivables data with RLS + DPDP-aligned audit trail |
| 2     | COMPLETE    | Core backend APIs + auth for the receivables workflow      |
| 3     | COMPLETE    | Provider-abstracted integration connectors (mocks first)   |
| 4     | Pending     | AI/agent layer with evals, guardrails, cost tracking       |
| 5     | Pending     | End-to-end receivables recovery workflow, owner-in-loop    |
| 6     | Pending     | Observability, cost controls, security + DPDP hardening    |
| 7     | **BLOCKED** | Pilot deployment — blocked until RISK #1 resolved          |

---

## Conventions

### Runtime & Language

- Node: `>=24.0.0` (enforced in `engines` field in every `package.json`)
- TypeScript: `^5.x` strict mode; no implicit `any`; no `eslint-disable` without a comment explaining why
- ESM throughout: `"type": "module"` in all package.json files
- Imports use explicit `.js` extensions (required by NodeNext module resolution)

### Lint & Format

- ESLint 9 (flat config `eslint.config.js`), `typescript-eslint` ^8
- Prettier 3: `singleQuote: true`, `semi: false`, `tabWidth: 2`, `printWidth: 100`, `trailingComma: "es5"`
- Pre-commit: husky + lint-staged (lint + format staged files)

### Commit Style

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
- Scope is preferred: `feat(api): add invoice endpoint`
- No `WIP` commits on `main`

### Branch Strategy

- `main` — production-ready; CI required; no direct pushes
- `develop` — integration branch
- `feat/<name>` — feature branches off `develop`
- Phase work: `feat/phase-N-<brief-name>` branches

### Test Commands

```bash
npm test                              # all workspaces
npm test -w apps/api                  # single workspace
npm run type-check                    # tsc --noEmit all workspaces
npm run lint                          # eslint .
```

### Run Locally

```bash
cp .env.example .env    # fill in secrets
npm install
npm run dev -w apps/api
```

---

## Hard Rules (Non-Negotiable)

1. **Phase order is strict.** Never write feature code for a later phase.
2. **Research before building.** Verify current docs/library versions before each phase. Do not rely on memory.
3. **Secrets in env only.** Never hardcode credentials. Always ship `.env.example`.
4. **No large data in context.** Sample schemas/headers only. Never load full datasets, binaries, or dumps.
5. **Blocker = STOP.** If validation fails, a prerequisite contradicts the plan, or a blocker appears — surface it to the owner; do not silently work around it.
6. **Deterministic logic stays deterministic.** Date math, overdue calculations, thresholds — NO LLM. LLM only for language generation.
7. **Privacy by default.** PII redacted before leaving the private boundary. RLS on every table. Minimal scopes on every token.
8. **DPDP compliance is not a later concern.** Build consent records, audit trail, and data-rights endpoints from Phase 1 onward.

---

## DPDP Rules 2025 — Key Obligations (Data Processor)

Rules passed November 2025; 12-month implementation phase for Consent Managers.

- **Consent:** Must include a mechanism for withdrawal (as easy as giving consent); Consent Manager registration required within 12 months of Nov 2025
- **Data Principal rights:** Access summary, correction, erasure — respond within 90 days
- **Erasure:** Must cascade to all data processors; audit logged
- **Breach notification:** Report to DPBI Board required
- **Retention:** Data not needed for stated purpose must be deleted; retention policy documented
- **Scope:** v1 is unlikely to be classified as Significant Data Fiduciary (SDF), so DPIA is not mandatory — but advisable

---

## ADRs

See [/docs/adr/](./docs/adr/) for all architectural decisions.

- [ADR-0001](./docs/adr/ADR-0001-stack.md): Technology stack selection (Phase 0)
- [ADR-0002](./docs/adr/ADR-0002-data-model.md): Data model & RLS architecture (Phase 1)
- [ADR-0003](./docs/adr/ADR-0003-api-auth.md): API auth pattern — JWKS-verified Supabase JWT + per-request Supabase client (Phase 2, amended Phase 3)
- [ADR-0004](./docs/adr/ADR-0004-connectors.md): Provider-abstracted connectors, Tally relay-agent finding, croner orchestration decision (Phase 3)

---

## Progress Tracker

See [PROGRESS.md](./PROGRESS.md).
