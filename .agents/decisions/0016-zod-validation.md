---
id: ADR-0016
title: Zod for all input validation
status: accepted
date: 2026-05-22
tags: [api, types]
supersedes: null
related: [ADR-0007]
---

# ADR-0016: Zod for All Input Validation

## Context

TypeScript types don't exist at runtime. `req.body` is `any` until we parse it. We need a single tool that does (a) runtime validation, (b) TypeScript type inference, and (c) ideally produces machine-readable schemas for later use (OpenAPI, codegen).

## Decision

**Every** request body, query string, route param, and header is parsed through a zod schema before reaching the controller. Schemas live in `src/schemas/<resource>.ts` and double as TypeScript types via `z.infer<typeof Schema>`.

```typescript
// src/schemas/task.ts
export const CreateTaskInput = z.object({
  title: z.string().min(1).max(500),
  targetDate: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;
```

Controllers receive `CreateTaskInput` — already validated, fully typed.

## Reasoning

- **TypeScript types don't validate at runtime.** Without parsing, `req.body` could be anything.
- **Single source of truth.** Same schema is the type, the validator, and (later) the OpenAPI source.
- **Zod has the best TypeScript ergonomics** in the ecosystem (vs Joi, Yup, io-ts).
- **Errors are descriptive.** Zod's error messages include the failing path, which we surface to the client in the standard error shape.

## Alternatives Considered

- **Joi** — older, types are second-class.
- **Yup** — designed for forms; backend ergonomics weaker.
- **io-ts** — most powerful, but verbose.
- **No validation; trust the frontend** — never. The frontend is not authoritative on what reaches our server.

## Consequences

- Every endpoint has at least one zod schema (input). Many have an output schema too.
- Schemas are imported in routes/controllers; types are imported in services.
- When OpenAPI generation comes back ([ADR-0020](./0020-deferred-openapi.md)), `@asteasolutions/zod-to-openapi` will derive specs from these schemas automatically.

## Revisit If

Never. Zod is the right tool.
