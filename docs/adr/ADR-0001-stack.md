# ADR-0001: Technology Stack Selection

**Date:** 2026-06-15
**Status:** Accepted
**Phase:** 0

---

## Context

CoreOps needs a backend API, a database with tenant-level data isolation, a lightweight owner dashboard, and LLM integration for an Indian SMB receivables recovery product. Key constraints:

- TypeScript across the stack for type safety and hiring pool fit
- Data isolation enforced at the infrastructure level (trust moat principle)
- Low operational overhead for a v1 single-tenant pilot
- WhatsApp as the primary delivery channel
- Must be DPDP Rules 2025 compliant before any real customer data is processed
- Indian SMB context: cost-sensitive; Zoho Books and Tally are dominant accounting tools

---

## Decision

| Layer | Chosen | Alternatives Considered | Reason Chosen |
|-------|--------|------------------------|---------------|
| Runtime | Node.js 24 LTS | Node 22 (maintenance), Node 26 (Current, not yet LTS) | Active LTS until April 2028; stable foundation |
| Language | TypeScript 5.x strict | JavaScript, Python | Type safety; single language across API + dashboard; reduces integration bugs |
| API framework | Fastify 5.8.5 | Express 4/5, NestJS, Hono | Native TS generics + schema-first validation; 3× Express throughput; JSON Schema → OpenAPI for free |
| Database | Supabase (Postgres + RLS + Auth) | PlanetScale, Railway, self-hosted Postgres | RLS enforces tenant data isolation as a database invariant, not application logic; auth and storage included |
| Dashboard | Next.js + Tailwind | Remix, SvelteKit, plain React | React Server Components; same TS ecosystem; large Indian hiring pool |
| Test runner | Vitest 3.x | Jest, Mocha | Faster; native ESM/TS support; no Babel required; Vite-compatible if dashboard shares logic |
| Monorepo | npm workspaces | Turborepo, pnpm workspaces, Nx | Zero extra tooling at v1 scale; built into npm |
| LLM | Anthropic Claude (provider-abstracted interface) | OpenAI GPT-4o, Gemini, self-hosted | Cost/quality ratio for structured output generation; provider interface prevents lock-in |
| WhatsApp | Meta Cloud API (direct) | BSP aggregators (Gupshup, Kaleyra, etc.) | No middleman markup; full webhook control; direct access to pricing tiers |
| Orchestration | TypeScript cron jobs (v1) | n8n, Temporal, Inngest, Zapier | No extra runtime; full type safety; n8n deferred to Phase 3 evaluation (see ADR-0002) |

---

## Consequences

**Positive:**
- Single language (TypeScript) across all layers reduces context-switching and interview bar
- Supabase RLS means data isolation is a database-enforced invariant — a tenant boundary violation requires bypassing Postgres, not just a code bug
- Fastify's schema-first approach naturally produces API contracts for future external integrations
- Provider abstraction for LLM and WhatsApp allows cost optimization as the product scales without rewriting business logic
- npm workspaces is zero-config; easy to remove if Turborepo becomes necessary later

**Negative / Trade-offs:**
- Supabase is a managed service — introduces a vendor dependency; mitigation: RLS is standard Postgres, so self-hosting on any Postgres provider is always possible
- npm workspaces lacks Turborepo's caching and parallel task execution; acceptable at v1 scale with 2 workspaces
- Fastify v5 has fewer community plugins than Express; acceptable given Fastify's rapidly growing plugin ecosystem
- NodeNext module resolution requires explicit `.js` import extensions — minor developer friction, enforced by CI

**Review triggers:**
- Reassess Supabase if multi-tenant scale exceeds free/pro tier capacity
- Revisit n8n if Phase 3 research shows it meaningfully reduces orchestration complexity (will record as ADR-0002)
- Revisit LLM provider at Phase 4 based on eval results and per-token cost at pilot volume

---

## References
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Fastify v5 release notes](https://github.com/fastify/fastify/releases)
- [Supabase RLS guide](https://supabase.com/docs/guides/auth/row-level-security)
- [WhatsApp Cloud API pricing (post-Jul 2025)](https://developers.facebook.com/docs/whatsapp/pricing)
- [DPDP Rules 2025](https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Rules%2C%202025.pdf)
