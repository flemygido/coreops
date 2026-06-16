# ADR-0005: AI/Agent Layer — Model Choice, Privacy Boundary, Guardrails, Cost Tracking

**Date:** 2026-06-16
**Status:** Accepted
**Phase:** 4

---

## Context

Phase 4 builds the AI layer the wedge workflow depends on: turning a deterministically-computed overdue invoice (Phase 1's `summariseOverdue`, assembled per-business by `receivables-state.ts`) into a draft WhatsApp follow-up message the owner can review and send. Per Hard Rule #6, the LLM only ever generates _language_ — every amount, date, and overdue calculation it's given was already computed deterministically before the model ever sees it, and nothing the model returns is treated as authoritative for those numbers.

This phase also surfaced a real bug while building it: `apps/api/src/routes/follow-ups.ts`'s schema referenced columns (`channel`, `message_text`, `resolved_at`) and status values (`pending`, `responded`) that don't exist on the actual `follow_ups` table (it has `drafted_text`, `approved_at`, `whatsapp_message_id`, statuses `draft`/`approved`/`sent`/`failed`/`skipped` — see `supabase/migrations/20260615000001_schema.sql`). This was a Phase 2 bug, never caught because the only test touching that route checked the 401-without-auth path — the same blind-spot pattern as the JWKS auth bug (see PROGRESS.md). Fixed as part of this phase since Phase 4's output (`drafted_text`) has to land in this exact table correctly.

---

## Decision

### Model: Claude Haiku 4.5, not Sonnet or Opus

A follow-up draft is a short, structurally simple piece of text (customer name, invoice number, amount, days overdue, polite tone) — not a task that benefits from a larger model's reasoning depth. Haiku 4.5 is $1/$5 per million input/output tokens vs. Sonnet 4.6's $3/$15 — roughly a 3x cost difference for a high-volume, low-complexity call that runs once per overdue invoice per business per day. `LLM_MODEL` is an env var (default `claude-haiku-4-5-20251001`), so upgrading to Sonnet for quality reasons later is a config change, not a code change.

### Provider abstraction mirrors the connectors pattern

`apps/api/src/llm/types.ts` defines `LlmClient`; `registry.ts` is the only place that knows `LLM_PROVIDER=anthropic` maps to `AnthropicClient`. This matches `../connectors/registry.ts` (ADR-0004) and CLAUDE.md's stack rationale for the LLM row ("provider-abstracted... prevents lock-in"). `AnthropicClient` is the only file allowed to import `@anthropic-ai/sdk` directly.

### Structured output via `zodOutputFormat`, not parsed free text

`@anthropic-ai/sdk` 0.104.2's `client.messages.parse()` with `output_config.format: zodOutputFormat(schema)` forces the model to return JSON matching a Zod schema (`{ message_text: string }`), validated SDK-side before the caller ever sees it. This was chosen over asking the model for free text and regex-extracting a message — a malformed/empty response throws inside the SDK, not three call-sites downstream.

### Privacy: allowlist fields into the prompt, not denylist PII out of it

`apps/api/src/llm/redact.ts`'s `toFollowUpDraftInput()` takes a `ReceivablesStateItem` (which includes `customer_phone`, `customer_id`, `invoice_id`) and returns only `{ customer_name, invoice_number, amount_outstanding, currency, days_overdue }`. Phone numbers and internal IDs never get assembled into a prompt at all — not because they're stripped, but because the function that builds the prompt input was never given a path to include them.

This was chosen over regex/entity-detection PII scrubbing (e.g. Microsoft Presidio, the common 2026 approach for freeform text) because the input here is structured DB rows whose shape we already control — allowlisting is simpler and strictly safer than trying to detect "PII-shaped" substrings in a field that's just JSON we built ourselves.

### Guardrails: schema-constrained input + output validation, no auto-send

`apps/api/src/llm/guardrails.ts`'s `checkFollowUpDraft()` rejects a draft that's empty, over 320 characters, contains a URL, or fails to mention the customer name or invoice number. This runs after every generation, inside `follow-up-draft.ts`'s orchestration — a draft that fails never reaches a caller. This is a second layer, not the only one: the wedge's workflow design (Phase 5) has the owner approve every draft before send, so nothing this layer produces is ever sent automatically.

### Cost tracking: deterministic arithmetic, logged per call

`apps/api/src/llm/cost-tracker.ts` holds an explicit per-model USD/million-token pricing table (Haiku 4.5: $1/$5, Sonnet 4.6: $3/$15, Opus 4.8: $5/$25 — Anthropic pricing, June 2026) and computes `cost_usd` from the token counts the Messages API returns on every call. `logLlmUsage()` writes one row per call to a new `llm_usage_log` table (migration `20260616000001_llm_usage_log.sql`), RLS-scoped so a business can only read its own usage, insert-only by the service role (the API process, not the user). An unrecognized model throws rather than silently returning `0` cost — a stale pricing table should fail loudly, not under-report spend.

### Evals: Vitest golden-set against the real API, not a new framework

`apps/api/src/llm/__tests__/follow-up-draft.eval.test.ts` runs a small fixed set of invoice scenarios through the _real_ Anthropic API (gated on `ANTHROPIC_API_KEY`, `describe.skipIf` — same pattern as the Supabase-gated integration tests) and asserts each draft passes guardrails. Promptfoo is the closer-to-standard 2026 tool for this, but it's a new framework/dependency for one workflow at v1 scale — a Vitest-based eval suite fits the existing test infrastructure and CLAUDE.md's own "no extra tooling at v1 scale" bias (the same reasoning behind npm workspaces over a heavier monorepo tool).

**Caveat:** this eval suite has not been run against the live Anthropic API in this session — no `ANTHROPIC_API_KEY` is configured in this environment, so it skipped (verified: the "skipped notice" test confirms it skipped because the key was absent, not silently). It needs a real run with a real key before Phase 4 can be considered fully verified end-to-end, the same standard applied to the Phase 2 auth bug.

---

## Consequences

**Positive:**

- Swapping models (Haiku → Sonnet) or providers (Anthropic → another) is a config/registry change, not a rewrite
- The privacy boundary is enforced by what data a function _can_ construct, not by a scrubbing pass that could miss a pattern
- Cost is visible per business, per call, from day one — not retrofitted once spend becomes a problem
- Found and fixed a real Phase 2 bug (`follow-ups.ts` schema mismatch) before it could affect Phase 5's wiring

**Negative / Trade-offs:**

- The eval suite is unverified against the live API as of this phase — must be run with a real `ANTHROPIC_API_KEY` before Phase 5 depends on it
- `redact.ts`'s allowlist must be manually kept in sync if `ReceivablesStateItem` gains new fields later — a forgotten allowlist update wouldn't leak by default (allowlist, not denylist), but a developer adding a new field who _wants_ it in the prompt has to remember to add it here explicitly
- Guardrails check for a URL/length/name-mention but not tone or factual accuracy beyond what's mechanically checkable — owner review remains the real safety net for those

---

## Rejected alternatives

- **Sonnet 4.6 as the default model:** 3x the cost for a task that doesn't need the extra reasoning depth; kept as the documented upgrade path via `LLM_MODEL`, not the default
- **Regex/entity-detection PII redaction (Presidio-style):** unnecessary complexity for structured DB-row input we already control the shape of; allowlisting is simpler and safer for this specific data path
- **Promptfoo for evals:** a real, standard tool, but a new framework/dependency for a single workflow at v1 scale; revisit if Phase 5/6 needs red-teaming or multi-prompt comparison Promptfoo specializes in
- **Free-text generation + regex extraction of the message:** rejected in favor of `zodOutputFormat` — schema-enforced output fails fast inside the SDK instead of producing a malformed message three layers downstream
