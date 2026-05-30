import type { UserModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type User = UserModel;

export interface CreateUserData {
  email: string;
  name: string;
  passwordHash: string;
  orgId: string;
  role?: "staff" | "manager" | "admin";
}

export function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Sprint 15: batch lookup by id. Used by meeting.service.ts to (a) validate
 * same-org membership of attendees at create time, and (b) hydrate the
 * attendees array on read. Returns only the public-summary projection.
 */
export function findByIds(
  ids: string[],
): Promise<Pick<User, "id" | "email" | "name" | "role" | "orgId">[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, name: true, role: true, orgId: true },
  });
}

export function create(data: CreateUserData): Promise<User> {
  return prisma.user.create({ data: omitUndefined(data) });
}

/**
 * Sprint 14 addendum: same-org user search by name or email substring
 * (case-insensitive). Used by the manager dashboard's "Add Existing" flow
 * and intended for reuse on the Meetings page. `q` optional → returns the
 * full org list (capped at `take`). Excludes deleted/disabled state filters
 * because we don't have those columns yet — revisit when the schema gains
 * `User.deletedAt` or `User.disabled`.
 */
export function searchSameOrg(
  orgId: string,
  q: string | undefined,
  take: number,
  maxLevel?: number,
): Promise<Pick<User, "id" | "email" | "name" | "role" | "level">[]> {
  const baseWhere = q
    ? {
        orgId,
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : { orgId };
  const where = maxLevel !== undefined ? { ...baseWhere, level: { lt: maxLevel } } : baseWhere;
  return prisma.user.findMany({
    where,
    take,
    orderBy: { name: "asc" },
    select: { id: true, email: true, name: true, role: true, level: true },
  });
}
