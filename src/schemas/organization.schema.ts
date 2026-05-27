import { z } from "zod";

/**
 * Sprint 18 (L1): root-only org creation. Slug-ish id is optional; if omitted
 * Prisma assigns a cuid. Name must be unique org-wide.
 */
export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  id: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "id must be lowercase letters, digits, or hyphens")
    .optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * Bootstraps the first admin of an org. Email + name + password + role=admin.
 * Issued via `POST /orgs/:id/admins` (root only) so a new tenant has a way in.
 */
export const bootstrapAdminSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(6).max(200),
});
export type BootstrapAdminInput = z.infer<typeof bootstrapAdminSchema>;
