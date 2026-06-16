# ADR-0003 — API Authentication Pattern

**Date:** 2026-06-16
**Status:** Accepted (amended 2026-06-16 — see Amendment below)
**Phase:** 2

---

## Amendment (2026-06-16)

The original Decision below assumed Supabase issues HS256 JWTs signed with a static
`SUPABASE_JWT_SECRET`. Testing against a live local Supabase instance during Phase 3
showed this is no longer true: Supabase signs access tokens with **project-specific
asymmetric keys (ES256), identified by a rotating `kid`** in the JWT header. A static
HS256 secret cannot verify these tokens, so the original implementation silently failed
on every real token (it was only ever exercised against the _absence_ of a token, never
a valid one).

**Corrected approach:** verification now uses `supabase-js`'s `auth.getClaims(token)`,
which fetches and caches the project's JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
and verifies the signature locally via WebCrypto. This replaces the `@fastify/jwt` +
static-secret step in the Decision and Implementation sections below — there is no
`SUPABASE_JWT_SECRET` anymore. Everything else in this ADR (per-request RLS client,
business_id resolution, `supabaseAdmin` isolation) is unchanged.

---

## Context

Every protected API route must:

1. Verify the caller is authenticated (JWT from Supabase Auth)
2. Resolve which business the caller owns
3. Enforce row-level data isolation with zero extra code per route

We chose Supabase as our auth provider. ~~Supabase issues HS256 JWTs signed with a known secret (`SUPABASE_JWT_SECRET`).~~ _(Superseded — see Amendment: Supabase signs with rotating asymmetric ES256 keys, verified via JWKS.)_ We need to decide how the Fastify API verifies these tokens and how RLS is applied per request.

---

## Decision

**Two-layer auth pattern:**

1. The auth plugin verifies the Supabase JWT via `supabase-js`'s `getClaims()` (local JWKS verification — see Amendment). Rejected early — before any business logic runs.

2. On every authenticated request, a **per-request Supabase client** is created carrying the user's JWT as the `Authorization: Bearer` header. All DB queries on this client automatically obey Supabase RLS policies — no manual `WHERE business_id = ?` required in route handlers.

3. After JWT verification, the auth plugin resolves `businessId` by querying the `businesses` table through the RLS client. If no business exists for the user, the request is rejected (401). This is how onboarding enforcement works.

4. `supabaseAdmin` (service-role client) is created once at startup as a Fastify decorator. It bypasses RLS and is **never** passed to route handlers — only used for system-level jobs (audit writes, migrations).

---

## Implementation

```
plugins/auth.ts
  └─ verifies the bearer token via the per-request client's auth.getClaims() (JWKS, ES256)
  └─ decorates app with `authenticate` preHandler
  └─ decorates request with `businessId` and `supabase` (per-request client)

plugins/supabase-admin.ts
  └─ decorates app with `supabaseAdmin` (service role, singleton)

routes/*.ts
  └─ all protected routes: preHandler: [app.authenticate]
  └─ use `req.supabase` for all DB queries (RLS automatic)
  └─ never access `app.supabaseAdmin`
```

---

## Consequences

**Good:**

- RLS is the only isolation layer needed in route handlers — no per-query tenant filtering
- Token verification and business resolution happen once in the preHandler, not once per query
- `supabaseAdmin` is structurally inaccessible from user-facing routes (only on `FastifyInstance`, not `FastifyRequest`)
- Stateless — no session storage; each request is fully self-contained

**Trade-offs:**

- One extra DB query per request (business_id lookup). Acceptable at v1 scale; can be cached (Redis/in-memory) in Phase 6 if it shows in profiling
- `getClaims()` falls back to a network round-trip (`getUser()`-equivalent) if the project ever reverts to symmetric (HS256) signing or the JWKS lookup fails — acceptable as a fallback, not the steady-state path

---

## Rejected alternatives

- **Session cookies:** Stateful; complicates horizontal scaling; not suitable for future mobile/WhatsApp webhook receivers
- **Supabase `getUser()` call per request:** Makes a network round-trip to Supabase Auth service on every request. `getClaims()` verifies locally against a cached JWKS and only falls back to a network call when asymmetric verification isn't possible
- **`fastify-jwt-jwks` (Nearform plugin):** Considered during the JWKS fix, but it only supports RS256/EdDSA verification, not ES256 — incompatible with Supabase's actual signing algorithm
- **Manual `WHERE business_id = ?` in every query:** Error-prone; RLS is more secure (enforced at DB level even if app code has bugs)
