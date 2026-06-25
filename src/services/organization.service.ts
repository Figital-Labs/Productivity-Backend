import { ConflictError, NotFoundError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import prisma from "../lib/prisma.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import type {
  BootstrapAdminInput,
  CreateOrganizationInput,
} from "../schemas/organization.schema.js";

export interface PublicOrganization {
  id: string;
  name: string;
  createdAt: string;
  userCount: number;
  isCurrent: boolean;
}

function toPublic(
  org: { id: string; name: string; createdAt: Date; _count: { users: number } },
  currentOrgId: string,
): PublicOrganization {
  return {
    id: org.id,
    name: org.name,
    createdAt: org.createdAt.toISOString(),
    userCount: org._count.users,
    isCurrent: org.id === currentOrgId,
  };
}

export async function listOrganizations(actor: AuthenticatedUser): Promise<PublicOrganization[]> {
  // Root sees all orgs; everyone else sees only their own. This lets the FE
  // reuse the same endpoint for a "switch org" picker (root) and a single-row
  // "current org" badge (everyone else) without a separate /me/org endpoint.
  const orgs = await prisma.organization.findMany({
    where: actor.isSuperAdmin ? {} : { id: actor.orgId },
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });
  return orgs.map((org) => toPublic(org, actor.orgId));
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<PublicOrganization> {
  if (input.id) {
    const existing = await prisma.organization.findUnique({ where: { id: input.id } });
    if (existing) {
      throw new ConflictError("ORGANIZATION_EXISTS", `Org "${input.id}" already exists.`);
    }
  }
  try {
    const org = await prisma.organization.create({
      data: { name: input.name, ...(input.id !== undefined && { id: input.id }) },
      include: { _count: { select: { users: true } } },
    });
    return toPublic(org, org.id);
  } catch (err: unknown) {
    // Unique violation on `name`.
    if (err instanceof Error && err.message.includes("Organization_name_key")) {
      throw new ConflictError("ORGANIZATION_NAME_TAKEN", `Org name "${input.name}" is taken.`);
    }
    throw err;
  }
}

/** Rename an org (root-only). Name is unique. */
export async function updateOrganization(orgId: string, name: string): Promise<PublicOrganization> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new NotFoundError("Organization", orgId);
  try {
    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { name },
      include: { _count: { select: { users: true } } },
    });
    return toPublic(updated, orgId);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Organization_name_key")) {
      throw new ConflictError("ORGANIZATION_NAME_TAKEN", `Org name "${name}" is taken.`);
    }
    throw err;
  }
}

/**
 * Bootstrap the first admin user of an org. Sets canManageUsers=true so they
 * can immediately invite their dept heads / staff. Org must already exist.
 */
export async function bootstrapAdmin(
  orgId: string,
  input: BootstrapAdminInput,
): Promise<{ id: string; email: string; name: string; orgId: string }> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new NotFoundError("Organization", orgId);

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError("USER_ALREADY_EXISTS", "A user with this email already exists.");
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      orgId,
      role: "admin",
      level: 800,
      canManageUsers: true,
    },
    select: { id: true, email: true, name: true, orgId: true },
  });
  return user;
}
