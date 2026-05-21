import type { AuthenticatedUser } from "../middleware/auth.js";

interface OwnedResource {
  userId: string;
}

/**
 * Per ADR-0008: POC has a single user so this trivially passes. The check is
 * written out so that when manager/staff hierarchy lands the rule gets richer
 * here, not via a search-and-replace across services.
 */
export function canAccess(user: AuthenticatedUser, resource: OwnedResource): boolean {
  return user.id === resource.userId || user.role === "admin";
}
