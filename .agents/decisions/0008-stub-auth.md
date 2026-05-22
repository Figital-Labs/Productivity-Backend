---
id: ADR-0008
title: Stub auth via `X-User-Id` header, schema multi-tenant ready
status: superseded
date: 2026-05-22
tags: [auth, schema]
supersedes: null
related: [ADR-0007]
---

# ADR-0008: Stub Auth via `X-User-Id` Header

## Context

The POC has one user. Real auth (signup, login, password hashing, JWT issuance, reset flow, email provider) is days of work for a feature the client demo doesn't need to see. But the future product is hospital staff hierarchy — multi-tenant, manager-staff roles, manager review flows. The schema needs to anticipate that.

## Decision

For POC:
- **Middleware** reads `X-User-Id` from the request header and returns a hardcoded user object.
- **Schema** has real columns from day 1: `userId` foreign key on every owned entity; `orgId` and `role` columns on `User`.
- **`canAccess(user, resource)` helper** wraps every read/write. For POC it returns `true`. The helper is the single place authorization logic will live.

```typescript
// src/middleware/auth.ts (POC version)
export function stubAuth(req, res, next) {
  const userId = req.header('X-User-Id') || 'demo-user-1';
  req.user = { id: userId, orgId: 'demo-org', role: 'staff' };
  next();
}
```

When real auth arrives later, this middleware is the only thing that changes.

## Reasoning

- **Zero auth library for POC.** Frontend sends `X-User-Id: demo-user-1` and we trust it.
- **Schema is real from day 1.** Adding real auth later means swapping the middleware, not migrating tables.
- **The `canAccess` helper means business code never directly checks "is this my row"** — that one helper has all the logic. When hierarchy arrives, it gets logic; query sites don't change.

## Alternatives Considered

| Option | Time | Why rejected for POC |
|---|---|---|
| No `userId` at all | trivial | Destructive migration later. Boxes us in. |
| Email + password + JWT | 5–8 hrs | Adds password-reset complexity (email provider, reset tokens). Client demo doesn't need it. |
| Google OAuth + JWT | 3–5 hrs | Viable choice when login becomes real (aligns with GCP stack, no email provider needed). Still not POC-critical. |
| Magic link (passwordless) | 4–6 hrs | Needs email provider. Skip for POC. |

## Consequences

- Every endpoint that mutates user-owned data must check `canAccess(req.user, resource)` before acting. For POC the check passes; the discipline is the point.
- Schema migrations don't need to add `userId` columns later — they're already there.
- The frontend team needs to know about the `X-User-Id` header convention. Documented in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Revisit If

- Multi-user testing begins (more than one `userId` exists).
- The client demo specifically needs a login screen.
- Frontend team requests a real auth flow.

**Likely successor:** Google OAuth + JWT, aligned with our GCP stack.
