# ADR-0004: Provider-Abstracted Connectors & Orchestration Approach

**Date:** 2026-06-16
**Status:** Accepted
**Phase:** 3

---

## Context

Phase 3 needs to let an owner connect their accounting and messaging tools (Zoho Books, Tally, Google Sheets, WhatsApp, Gmail) without the rest of the codebase caring which one they picked. Per Hard Rule #1 (phase order is strict), Phase 3 builds the abstraction and deterministic mocks only — real network calls, sync-into-DB logic, and scheduled orchestration are Phase 4/5 scope.

Research surfaced one finding that changes the architecture: **Tally Prime has no cloud API.** It only exposes local XML-over-HTTP or ODBC on the LAN the Tally install runs on. There is no hosted endpoint CoreOps can call from outside the customer's network.

---

## Decision

### Connector interfaces, not per-provider branching

Two interfaces cover all five providers:

- `AccountingConnector` (zoho_books, tally, google_sheets): `fetchCustomers`, `fetchInvoices`, `fetchPayments`, `testConnection`
- `MessagingConnector` (whatsapp, gmail): `sendMessage`, `testConnection`

A `registry.ts` factory (`getAccountingConnector(provider, credentials)` / `getMessagingConnector(...)`) is the only place that knows which concrete class backs which provider string. Routes and future sync jobs depend on the interface, never the concrete class.

### Mocks first, real calls deferred

Phase 3 ships deterministic, referentially-consistent mock implementations (`mocks/*.mock.ts`) for all five providers — same shape the real implementations will return, fixed sample data, credential-shape validation in `testConnection()`. No real HTTP calls exist yet. This lets `connected-accounts` CRUD routes, encryption, and the registry be fully tested now, with the real Zoho/WhatsApp/Gmail HTTP clients dropped in later phases behind the same interface.

### Tally requires an on-premise relay agent (architectural implication)

Because Tally has no cloud API, a pilot using Tally cannot be synced by CoreOps's backend calling out to Tally directly. The only viable path is a small agent process running on the customer's LAN (or the Tally machine itself) that CoreOps's backend talks to over an outbound connection the agent initiates — the reverse of every other connector. The `TallyMockConnector` already models this: its required credential field is `agent_url`, not an API token, to keep this constraint visible in the type system from Phase 3 onward. Building the actual relay agent is out of scope until a pilot customer is confirmed to be on Tally (see CLAUDE.md RISK #1 and Open Question #2 in PROGRESS.md) — no point building it speculatively.

### Orchestration: `croner`, not `node-cron` (research note for Phase 5)

CLAUDE.md's "Confirmed Tech Stack" already locks in-process TypeScript cron jobs over n8n for v1 (no extra runtime, full type safety). Phase 3 research compared the two common Node cron libraries for when Phase 5 builds the scheduler:

- `node-cron`: minimal, widely used, but no native DST/leap-year handling and a smaller TS-native surface
- `croner`: TypeScript-native, zero dependencies, correctly handles DST transitions and leap years, actively maintained

**Decision: use `croner` in Phase 5** when the daily-briefing scheduler is built. Not installed yet — Hard Rule #1 (no feature code for a later phase) means this stays a research note until Phase 5 starts.

---

## Consequences

**Positive:**

- Adding a sixth provider (e.g. a future accounting tool) means writing one class against an existing interface, not touching routes or registry call sites
- Mocks make the entire connected-accounts flow (encrypt → store → list → test → delete) testable today without any real third-party credentials
- The Tally relay-agent constraint is visible in the connector's required-credentials shape (`agent_url`) rather than buried in a comment that could be missed later

**Negative / Trade-offs:**

- The mock/real split means Phase 3's "passing tests" only prove the abstraction and CRUD plumbing work — they say nothing about real Zoho/Tally/WhatsApp API behavior. That verification has to happen again in Phase 4/5 against live provider sandboxes, the same lesson learned the hard way with the Phase 2 auth bug (see PROGRESS.md Process Note)
- If a pilot customer turns out to be Tally-only, Phase 5 effectively gains an unplanned sub-project (build + deploy + support the relay agent) that a Zoho-only pilot would not require

---

## Rejected alternatives

- **n8n for orchestration:** Already rejected in CLAUDE.md's stack table for v1; revisit only if cron-job complexity grows beyond what hand-written TypeScript jobs can manage
- **Calling Tally's local HTTP/ODBC interface directly from the CoreOps backend:** Impossible without the backend being on the same LAN as the customer's Tally install; rejected as architecturally infeasible for a hosted SaaS backend
- **One generic `Connector` interface for both accounting and messaging providers:** Rejected — `fetchInvoices()` has no messaging analog and `sendMessage()` has no accounting analog; forcing them into one interface would mean optional methods and runtime type-narrowing everywhere they're used
