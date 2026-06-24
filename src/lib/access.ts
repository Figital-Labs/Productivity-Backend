import type { Scope } from "./resolve-scope.js";

/**
 * Canonical authorization bands. Numeric `level` (NOT the legacy `role` string)
 * is the source of truth for what a user can do. Tune the cutoffs here — every
 * gate reads these helpers, so behaviour stays consistent and configurable in
 * one place.
 *
 *   staff        100   — individual contributor
 *   group_lead   300   — lowest "manager surface" band
 *   dept_head    400
 *   admin        800   — org-wide authority
 *   super_admin  900   — cross-org root (also flagged via isSuperAdmin)
 */
export const LEVELS = {
  STAFF: 100,
  GROUP_LEAD: 300,
  DEPT_HEAD: 400,
  ADMIN: 800,
  SUPER_ADMIN: 900,
} as const;

/** Org-wide authority: see/manage the whole org. Replaces `role === "admin"`. */
export function isOrgAdmin(level: number): boolean {
  return level >= LEVELS.ADMIN;
}

/** Coarse "has a management surface" band. Replaces `role === "manager" | "admin"`. */
export function isManagerLevel(level: number): boolean {
  return level >= LEVELS.GROUP_LEAD;
}

export interface Capabilities {
  /** Scope is the whole org (admin). */
  orgWideScope: boolean;
  /** Sees the manager dashboard / team views. */
  canViewDashboard: boolean;
  /** Can assign/delegate tasks to others. */
  canDelegate: boolean;
  /** Can create/edit departments & groups (org-level structure). */
  canManageDeptGroups: boolean;
  /**
   * Owns user accounts: create/edit users, reset passwords, set reporting
   * managers. Admin-only — this is the flag the FE gates account UI on, and
   * what distinguishes an admin from a plain manager.
   */
  canManageUsers: boolean;
}

/**
 * Capabilities are derived from level (bands above) + relationships (the
 * resolved scope — i.e. "do you actually manage anyone"). This is exactly what
 * the frontend gates on; no role strings involved. `scope.type !== "none"`
 * means the user heads a dept, leads a group, has reports, or is an org admin.
 */
export function capabilitiesFor(level: number, scope: Scope): Capabilities {
  const managesSomeone = scope.type !== "none";
  return {
    orgWideScope: scope.type === "org",
    canViewDashboard: managesSomeone,
    canDelegate: managesSomeone,
    canManageDeptGroups: isOrgAdmin(level),
    canManageUsers: isOrgAdmin(level),
  };
}
