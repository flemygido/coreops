# ADR-0003 — API Authentication Pattern

**Date:** 2026-06-16
**Status:** Accepted
**Phase:** 2

---

## Context

Every protected API route must:

1. Verify the caller is authenticated (JWT from Supabase Auth)
2. Resolve which business the caller owns
3. Enforce row-level data isolation with zero extra code per route

We chose Supabase as our auth provider. Supabase issues HS256 JWTs signed with a known secret (`SUPABASE_JWT_SECRET`). We need to decide how the Fastify API verifies these tokens and how RLS is applied per request.

---

## Decision

**Two-layer auth pattern:**

1. `@fastify/jwt` at the app level verifies the Supabase JWT using `SUPABASE_JWT_SECRET`. Rejected early — before any business logic runs.

2. On every authenticated request, a **per-request Supabase client** is created carrying the user's JWT as the `Authorization: Bearer` header. All DB queries on this client automatically obey Supabase RLS policies — no manual `WHERE business_id = ?` required in route handlers.

3. After JWT verification, the auth plugin resolves `businessId` by querying the `businesses` table through the RLS client. If no business exists for the user, the request is rejected (401). This is how onboarding enforcement works.

4. `supabaseAdmin` (service-role client) is created once at startup as a Fastify decorator. It bypasses RLS and is **never** passed to route handlers — only used for system-level jobs (audit writes, migrations).

---

## Implementation

```
plugins/auth.ts
  └─ registers @fastify/jwt with SUPABASE_JWT_SECRET
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
- Supabase JWT secret must be rotated carefully — it signs all user tokens

---

## Rejected alternatives

- **Session cookies:** Stateful; complicates horizontal scaling; not suitable for future mobile/WhatsApp webhook receivers
- **Supabase `getUser()` call per request:** Makes a network round-trip to Supabase Auth service. `@fastify/jwt` local verification is faster and more reliable
- **Manual `WHERE business_id = ?` in every query:** Error-prone; RLS is more secure (enforced at DB level even if app code has bugs)
