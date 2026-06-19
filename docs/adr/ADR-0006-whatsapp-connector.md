# ADR-0006: Real WhatsApp Business Cloud API Connector

**Status:** Accepted
**Date:** 2026-06-19
**Phase:** 6.5

---

## Context

Phase 3 shipped a mock WhatsApp connector. Phase 6.5 builds the real connector to validate the end-to-end receivables follow-up path before the Phase 7 pilot.

Meta's WhatsApp Cloud API has two fundamentally different message types with different cost profiles:

| Path                     | Trigger                                   | Cost       |
| ------------------------ | ----------------------------------------- | ---------- |
| Session (free-form text) | Recipient messaged first (< 24 h ago)     | Free       |
| Utility template         | Any time (pre-approved template required) | ~₹0.82/msg |

Both paths are needed: the owner receives briefings via session messages (they are actively using the product), while debtors (customers) may receive follow-ups cold (template required).

---

## Decision

### 1. Explicit two-path architecture

`sendSessionMessage()` and `sendTemplateMessage()` are separate methods, not a single unified send. The `sendMessage()` interface method dispatches to one of them based on live window state in the DB.

**Why explicit separation:** A unified method that silently falls back to a paid template would hide cost and compliance risks. Making each path explicit forces the caller to know which type is being used.

### 2. Fail loudly when neither path is viable

If `sendMessage()` is called with no open window AND no approved template:

- `WhatsAppNoWindowError` — no window, no `template_vars` in payload
- `WhatsAppNoTemplateError` — no window, has template_vars, but `template_name` credential is unset

Both are thrown as typed errors, not returned as `{ ok: false }`. This ensures the send-follow-up service and the operator see a hard failure instead of a silent skip of an overdue invoice.

### 3. Window tracking in Postgres

24-hour service windows are persisted in `whatsapp_windows` (business_id + recipient_phone, unique constraint, upserted on each inbound message). The table survives API restarts, is accessible by the admin for debugging, and can be queried in the follow-up list UI in a future phase.

**Alternative considered:** In-memory TTL cache. Rejected: state would be lost on restart, incorrect in multi-instance deployments.

### 4. Feature flag via `WHATSAPP_ENABLED`

The registry returns the real connector only when `WHATSAPP_ENABLED=true`. When false (default), the mock runs. This allows the real connector to ship on `main` without activating it until all credentials and the template are ready.

### 5. Signature verification without `@fastify/rawbody`

The webhook POST handler verifies Meta's HMAC-SHA256 signature. Fastify parses JSON before request handlers run, destroying the raw bytes needed for HMAC. Solution: `preParsing` hook (Fastify's lifecycle hook that fires before body parsing) captures the raw `Buffer`, stores it on the request, and returns a new `Readable.from([rawBody])` for the body parser to consume. This is scoped to the `whatsappWebhookRoutes` plugin, leaving other routes unaffected. No extra dependency required.

**Alternative considered:** `@fastify/rawbody` plugin. Rejected: adds a dependency for a single-purpose need that the `preParsing` hook solves cleanly.

### 6. Phone normalization

Meta webhook events deliver sender phones as digits-only (e.g. `919751723512`). Customer records in the DB may include spaces or dashes. `normalizePhone()` strips non-digits and prepends `+` before any DB lookup or write. This function is exported for independent unit testing.

---

## Consequences

**Positive:**

- The two-path separation makes the WhatsApp cost model explicit in code and review.
- `WhatsAppNoTemplateError` surfaces the template approval gap loudly during development rather than silently at pilot launch.
- Window tracking in Postgres enables future features (show "window open" status in the owner dashboard).

**Negative / trade-offs:**

- `send-follow-up.ts` now makes an extra DB query (invoice load) to populate template_vars. Acceptable: the service is called at most once per follow-up send, not in a loop.
- Phone normalization is a simple strip-and-prepend; won't handle international numbers without a `+` prefix and no leading country code. Acceptable for the Indian-SMB MVP (E.164 is the expected format).

---

## Go-Live Dependencies (Phase 7 blockers)

1. **Template approval:** `invoice_follow_up` utility template must be approved in Meta Business Manager before cold debtor follow-ups can be sent. Until then, `sendTemplateMessage()` throws `WhatsAppNoTemplateError` (error code 132001 from Meta).

2. **Meta Business Portfolio restriction:** The test WABA is currently restricted (flagged in CLAUDE.md). Must be resolved before any customer messages can be sent.

3. **`WHATSAPP_PHONE_NUMBER_ID` in `.env`:** Required for real connector activation and live integration tests.
