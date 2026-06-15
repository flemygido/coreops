# CoreOps — PROGRESS.md

Living progress tracker. Updated at the end of every phase. Read this alongside CLAUDE.md at the start of every session.

---

## Current Phase
**Phase 0 — Validation Gate + Scaffold** | Status: **IN PROGRESS**

---

## Phase History

| Phase | Status | Date | Commit |
|-------|--------|------|--------|
| 0 | IN PROGRESS | 2026-06-15 | — |

---

## Phase 0 Checklist

### Prerequisite Research
- [x] Node.js current LTS: v24.15.0 (v24 active LTS; v26 Current but not yet LTS until Oct 2026)
- [x] Fastify current stable: v5.8.5
- [x] Supabase JS client current: @supabase/supabase-js v2.108.1
- [x] WhatsApp Cloud API pricing verified: per-message since 1 Jul 2025; utility/service inside CSW = free
- [x] DPDP Rules 2025: passed Nov 2025; key obligations documented in CLAUDE.md

### Foundation Files
- [x] CLAUDE.md created with all §0 items locked or marked ASSUMED+RISK
- [x] PROGRESS.md created
- [x] /docs/adr/ created; ADR-0001 written

### Repo Scaffold
- [x] Folder structure created (apps/api, packages/shared, docs/adr, .github/workflows)
- [x] Root package.json (npm workspaces)
- [x] tsconfig.base.json
- [x] eslint.config.js (ESLint 9 flat config + typescript-eslint)
- [x] .prettierrc
- [x] .env.example (no secrets)
- [x] .gitignore
- [x] .nvmrc (Node 24)
- [x] apps/api scaffold (package.json, tsconfig, vitest config, src/index.ts)
- [x] apps/api placeholder test
- [x] packages/shared scaffold
- [x] .husky/pre-commit hook
- [x] .github/workflows/ci.yml (lint + type-check + test + secrets scan)
- [x] README.md

### Validation
- [x] `npm install` runs successfully (0 vulnerabilities; vitest pinned to ^4.0.0)
- [x] `npm run lint` passes (zero errors)
- [x] `npm run type-check` passes (zero errors, both workspaces)
- [x] `npm test` passes (vitest v4.1.9; 1 passed)
- [ ] Pre-commit hook functional (requires `git init` first — not yet a git repo)
- [ ] Owner has reviewed and approved Phase 0

---

## Open Questions / Blockers

| # | Question / Blocker | Priority | Status |
|---|--------------------|----------|--------|
| 1 | **RISK #1:** No confirmed paying customer — strategy is "publish to attract" | High | Open — blocks Phase 7 only (not earlier phases) |
| 2 | Does the pilot use Zoho Books or Tally? (affects Phase 3 integration scope) | High | Awaiting owner input |
| 3 | Pilot owner's WhatsApp number and WABA account status | Medium | Awaiting owner input — needed for Phase 7 onboarding |
| 4 | Is a GitHub repo already created, or does one need to be set up? | Medium | Awaiting owner input — needed to push and get CI green |

---

## Decisions Awaiting Approval

| # | Decision | Status |
|---|----------|--------|
| 1 | Phase 0: Wedge locked, stack chosen — see CLAUDE.md for full details | **Awaiting owner approval before Phase 1** |
