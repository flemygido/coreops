# ADR-0007 — Real Zoho Books Connector

**Date:** 2026-06-19
**Status:** Accepted
**Phase:** 6.5 (real connectors, PR #2 of 2)

---

## Context

Phase 3 built a `ZohoBooksMockConnector` that returns deterministic in-memory data. Phase 6.5 wires up the real Zoho Books REST API v3 so the receivables pipeline can read actual invoice and payment data from the pilot customer's Zoho Books account.

Key constraints entering this phase:

- Pilot customer is an Indian wholesaler/distributor — India data-center endpoints must be used (region-bound tokens).
- The connector must be multi-tenant-ready in its token management, even though v1 is single-tenant.
- The connector must plug into the existing `AccountingConnector` interface without changing any caller.

---

## Decisions

### 1. India DC endpoints (confirmed, non-negotiable)

Indian Zoho Books accounts use:

- **OAuth:** `https://accounts.zoho.in/oauth/v2/token`
- **API:** `https://www.zohoapis.in/books/v3/{resource}`

Tokens issued from `accounts.zoho.in` are **strictly region-bound** — using `accounts.zoho.com` credentials against `.in` API endpoints returns 401. The `api_domain` and `auth_domain` fields are stored in `ConnectorCredentials` with defaults pointing to the India DC. Non-India accounts can override these without code changes.

### 2. Token management: check-before-use + persist-after-refresh

**Decision:** Before every API request, check if the stored `access_token` is still valid (via `access_token_expires_at` with a 5-minute buffer). If expired (or absent), refresh using `refresh_token` before proceeding, then persist the new `access_token` + `access_token_expires_at` back to `connected_accounts.credentials_encrypted`.

**Rationale for persist-after-refresh:** Zoho access tokens expire in 1 hour. Without persistence, a daily sync across N businesses would generate N token-refresh calls on every run. At multi-tenant scale this exhausts Zoho's token-generation quota. Persisting the refreshed token means subsequent calls within the hour reuse it. This is the correct pattern for the multi-tenant-ready architecture we chose at Phase 1.

**Safety net:** On a 401 response (e.g., the token expired between the freshness check and the network round-trip), the connector performs one additional refresh and retries. If the retry also returns 401, it throws `ZohoBooksAuthError` — the owner must reauthorize.

**Token fields stored in `ConnectorCredentials`:**

- `client_id`, `client_secret`, `refresh_token` — long-lived, owner-supplied
- `access_token` — auto-managed; can be empty on first run
- `access_token_expires_at` — ISO timestamp; auto-managed
- `api_domain` — default `https://www.zohoapis.in`
- `auth_domain` — default `https://accounts.zoho.in`
- `organization_id` — required on every Zoho API request

### 3. Feature flag: `ZOHO_ENABLED`

Same pattern as `WHATSAPP_ENABLED`. The registry routes to the real connector when `ZOHO_ENABLED=true` AND `credentials.client_id` is set; otherwise falls back to the mock. Existing tests continue to run against the mock with no changes.

### 4. Invoice field mapping

Zoho Books returns a `balance` field (pre-calculated outstanding amount) directly on the invoice object. We derive `amount_paid = total - balance` rather than summing payment records. This is simpler and more reliable since Zoho's balance already accounts for credit notes, write-offs, and partial payments.

Zoho status → internal `InvoiceStatus` mapping:
| Zoho | Internal | Notes |
|---|---|---|
| `overdue` | `open` | Our overdue calculator re-derives this from `due_date` vs today (Hard Rule #6) |
| `unpaid` | `open` | |
| `sent` | `open` | |
| `viewed` | `open` | |
| `draft` | `open` | |
| `partially_paid` | `partial` | |
| `paid` | `paid` | |
| `void` | `void` | |

We do **not** rely on Zoho's `overdue` status for the receivables calculation — our `calculateOverdue()` function recomputes from `due_date` deterministically (Hard Rule #6: no LLM and no external state in date math).

### 5. Customer phone field: `mobile` preferred over `phone`

Zoho contacts carry both `mobile` and `phone`. We prefer `mobile` because it is the field Indian wholesalers typically fill in for WhatsApp-reachable numbers. `phone` is used as fallback.

### 6. Payment → invoice linking: KNOWN LIMITATION v1

Zoho customer payments can be applied to multiple invoices in a single transaction. The Zoho API returns this as a nested `invoices` array on the payment object. Our `ConnectorPayment` interface has a single `invoice_external_id` field — we link to `invoices[0].invoice_id`.

**KNOWN LIMITATION v1:** a single payment applied to multiple invoices links only to the first invoice; this can under-count `amount_paid` on the other invoices. This is acceptable for the pilot. **Revisit before scaling.**

**Note for the pilot:** the trial account includes a payment split across two invoices specifically to exercise this path. The first invoice will show a full payment; the second will still show as unpaid (balance unchanged). This is expected and documented behaviour, not a bug.

### 7. Rate limiting: fixed 60s backoff on 429

Zoho Books enforces 100 requests per minute per organisation. The response is HTTP 429. A `Retry-After` header is **not documented** for Zoho Books (unlike some other Zoho APIs). We use a fixed 60-second sleep before the first retry, then a second retry; after three 429s we throw `ZohoBooksRateLimitError`. At pilot scale (1 org, <200 invoices) this limit will not be reached under normal operation.

### 8. Typed errors

| Error class               | Code              | When thrown                                                           |
| ------------------------- | ----------------- | --------------------------------------------------------------------- |
| `ZohoBooksAuthError`      | `ZOHO_AUTH_ERROR` | 401 after refresh, refresh itself fails, missing required credentials |
| `ZohoBooksRateLimitError` | `ZOHO_RATE_LIMIT` | 429 after 3 attempts                                                  |

Both fail loudly — silent fallback would hide a misconfigured pilot account.

### 9. `getAccountingConnector` context param

`getAccountingConnector` now accepts an optional `AccountingContext` (`{ supabase?, connectedAccountId? }`) so the connector can persist refreshed tokens. The existing `getMessagingConnector` already has the same pattern for `WhatsAppConnector`. Callers that don't pass context still work — token refresh happens in-memory but is not persisted (degraded mode, acceptable for tests and dev).

---

## Consequences

- The receivables pipeline can now sync real invoice and payment data from the pilot's Zoho Books account.
- Token management is multi-tenant-safe: one DB write per refresh, not per request.
- The split-payment limitation is documented and will require a `ConnectorPayment[]` shape change when it becomes a problem (return one `ConnectorPayment` per invoice in the nested list, not per payment).
- Non-India accounts can use the same connector by overriding `api_domain` and `auth_domain` in credentials.
