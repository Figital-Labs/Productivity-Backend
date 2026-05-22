---
id: ADR-0022
title: Basic JWT auth for frontend integration
status: accepted
date: 2026-05-22
tags: [auth, api]
supersedes: ADR-0008
related: [ADR-0007, ADR-0015, ADR-0016]
---

# ADR-0022: Basic JWT Auth for Frontend Integration

## Context

ADR-0008 deliberately used a trusted `X-User-Id` header while the backend was a single-user POC. That was good enough until frontend integration needed real account boundaries and teammates needed to try multiple users.

The revisit condition in ADR-0008 has now been met: multi-user testing is needed, but the user explicitly asked for the minimum viable auth layer, not a production identity system.

## Decision

Replace stub auth with email/password signup, login, and JWT bearer tokens.

- Public endpoints:
  - `POST /api/v1/auth/signup`
  - `POST /api/v1/auth/login`
- Authenticated endpoint:
  - `GET /api/v1/auth/me`
- All other `/api/v1` routes require `Authorization: Bearer <token>`.
- JWT payload is `{ sub, orgId, role }`, matching the existing `req.user` contract after verification.
- Passwords are stored as bcrypt hashes in required `User.passwordHash`.
- Seeded demo credentials are:
  - email: `demo@kims.local`
  - password: `demopass123`
- `JWT_SECRET` is required at boot. `JWT_TTL` defaults to `30d`.

## Reasoning

- **Smallest useful auth surface.** Signup, login, and `/me` are enough for frontend work and multi-user testing.
- **No downstream rewrite.** Existing services already scope by `req.user.id`, so JWT auth only changes credential derivation.
- **JWT over server sessions for POC.** No session table, Redis, cookie/CORS tuning, or refresh-token lifecycle required.
- **bcryptjs over native bcrypt.** Pure JS avoids Windows/native build friction and is sufficient for this POC.
- **No backdoor header.** Keeping `X-User-Id` would undermine testing isolation because any client could impersonate any user.

## Alternatives Considered

| Option | Why rejected now |
|---|---|
| Keep `X-User-Id` | Does not support real multi-user testing. |
| OAuth | Better long-term, but too much setup for the current integration need. |
| Sessions/cookies | More infrastructure and browser policy surface than this POC needs. |
| Refresh tokens | Useful later, but not needed for a 30-day POC token. |

## Consequences

- Existing curl/Postman flows need a login step and bearer token header.
- Local `.env` files must define `JWT_SECRET`.
- `User.passwordHash` is now required, so every user row must be created through auth service or seed logic.
- Token revocation is not supported. Tokens remain valid until expiry.

## Out of Scope

- Password reset.
- Email verification.
- Refresh tokens and token rotation.
- OAuth/social login.
- Login rate limiting.
- Role-based authorization beyond exposing `req.user.role`.

## Revisit If

- The app is deployed beyond local POC usage.
- Tokens need revocation.
- Users need password reset.
- The client requires SSO/OAuth.
