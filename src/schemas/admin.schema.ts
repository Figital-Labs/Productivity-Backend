import { z } from "zod";

export const interactionTypeEnum = z.enum(["voice", "image", "text", "unified", "meeting"]);

export const aiUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const interactionsQuerySchema = z.object({
  type: interactionTypeEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const interactionParamsSchema = z.object({
  type: interactionTypeEnum,
  id: z.string().min(1),
});

/**
 * PATCH /orgs/:id — rename and/or set the org's branding logo. Both keys are optional, but
 * at least one must be present (an empty body is a no-op the caller almost certainly didn't
 * intend). `logoUrl: null` explicitly CLEARS the logo; omitting it leaves it unchanged.
 * The URL must be absolute + https — the frontend renders it in an <img>, and permitting a
 * relative or javascript: value would let a root-level typo break (or poison) every page.
 */
export const updateOrgSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    // Two accepted forms, both safe to drop straight into an <img src>:
    //   • absolute `https://…`  — the real per-tenant case (S3/CDN upload)
    //   • root-relative `/…`    — an asset shipped in the frontend bundle. This is how KIMS
    //     keeps its existing `/kims-logo.svg` with no upload step and no new infrastructure.
    // Everything else is rejected — notably `javascript:` and `data:`, which would otherwise
    // let a root-level typo (or a compromised root account) inject script into every page.
    logoUrl: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .refine(
        (u) => u.startsWith("https://") || (u.startsWith("/") && !u.startsWith("//")),
        "logoUrl must be an https:// URL or a root-relative path like /logo.svg",
      )
      .nullable()
      .optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.logoUrl !== undefined,
    "Provide at least one of `name` or `logoUrl`.",
  );

/** @deprecated Use `updateOrgSchema` — kept so any older caller sending only `name` still works. */
export const renameOrgSchema = updateOrgSchema;
