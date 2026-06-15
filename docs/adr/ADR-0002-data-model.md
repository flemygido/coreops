# ADR-0002: Data Model & RLS Architecture

**Date:** 2026-06-15
**Status:** Accepted
**Phase:** 1

---

## Context

CoreOps must model receivables recovery data for Indian SMBs while enforcing:

1. Tenant data isolation (one business cannot see another's data)
2. DPDP Rules 2025 compliance (consent records, audit trail, data-principal rights)
3. Multi-tenant-ready from day one (even though v1 is single-tenant pilot)
4. Credential security (Zoho, WhatsApp tokens must not leak)

---

## Decision

### Tenant isolation via RLS helper function

All tenant tables carry a `business_id` UUID. Rather than putting the isolation logic in every policy, a single `security definer` function resolves the current user's business:

```sql
create function get_current_business_id() returns uuid
  language sql stable security definer as $$
    select id from businesses where owner_user_id = auth.uid() limit 1;
  $$;
```

All RLS policies become `business_id = get_current_business_id()`. Marking it `stable` allows Postgres to cache it within a single query, avoiding N+1 subquery cost.

### Credential encryption at application layer

`connected_accounts.credentials_encrypted` stores an AES-256-GCM ciphertext blob (IV + auth tag + ciphertext, base64-encoded). The key comes from `ENCRYPTION_KEY` env var. Rationale:

- Column-level Postgres encryption (pgcrypto) would decrypt in DB memory — still exposed to the service role
- Application-layer encryption means credentials are opaque blobs in the DB; only the API process can decrypt them
- Auth tag provides tamper detection

### Audit log is append-only

The `audit_log` table has no UPDATE/DELETE policies. The auto-trigger fires on INSERT/UPDATE/DELETE of key tables and redacts `credentials_encrypted` before writing. This gives a tamper-evident trail required by DPDP.

### Consent records use `withdrawn_at` pattern

DPDP requires consent to be revocable. Rather than deleting consent records (which would destroy the audit trail), a `withdrawn_at` timestamp is set on withdrawal. This gives a complete consent lifecycle history.

### Overdue calculator is pure TypeScript

The calculation of "is this invoice overdue and by how much" is a deterministic pure function with no DB or LLM calls. Rationale:

- Testable in isolation (20 unit tests with edge cases)
- No risk of LLM hallucinating rupee amounts
- Timezone-safe: all date comparisons use UTC midnight to avoid DST/offset bugs

---

## Consequences

**Positive:**

- Tenant isolation is enforced at the Postgres level — a misconfigured API route cannot accidentally return another tenant's data
- Pure overdue calculator is fully unit-testable and auditable
- Append-only audit log satisfies DPDP data processing records
- Credential encryption means a DB dump cannot reveal integration tokens

**Negative / Trade-offs:**

- `security definer` functions run as the function owner, not the caller — must be careful not to expose unintended data through them; reviewed and accepted
- Application-layer encryption requires the API to be the sole credential accessor — acceptable for v1
- Multi-tenant RLS requires a `businesses` lookup on every authenticated query — mitigated by `stable` caching and an index on `businesses.owner_user_id`

---

## Schema Summary

| Table                | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `businesses`         | Tenant root; one row per business owner          |
| `connected_accounts` | Integration credentials (encrypted)              |
| `customers`          | Customer records synced from Zoho/Tally          |
| `invoices`           | Invoice data with status and payment tracking    |
| `payments`           | Payment records (negative amount = credit note)  |
| `briefings`          | Daily AI-generated owner briefings               |
| `follow_ups`         | Per-invoice WhatsApp draft → approve → send flow |
| `audit_log`          | Append-only DPDP compliance trail                |
| `consent_records`    | DPDP consent lifecycle (given/withdrawn)         |
