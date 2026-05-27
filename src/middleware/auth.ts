import type { Request, Response, NextFunction } from "express";

import { UnauthorizedError } from "../lib/errors.js";
import { verifyAuthToken } from "../lib/jwt.js";
import prisma from "../lib/prisma.js";

export interface AuthenticatedUser {
  id: string;
  orgId: string;
  role: "staff" | "manager" | "admin";
  /**
   * Sprint 11: precomputed set of user ids whose tasks this user can see by
   * virtue of being their manager. Empty for staff. Used by `canAccessTask`
   * and by the team-directory builder for AI delegation prompts.
   */
  reportIds: Set<string>;
  /** Sprint 18: cross-org root. Bypasses org-boundary checks. */
  isSuperAdmin: boolean;
  /** Sprint 18 (L8): grantable permission to create/manage other users. */
  canManageUsers: boolean;
  /** Sprint 18 (L7): the actor's level — primary input to the hierarchy ceiling check. */
  level: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthenticatedUser;
    }
  }
}

export async function jwtAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header("Authorization");
  if (!header) {
    throw new UnauthorizedError("Missing Authorization header");
  }

  const parts = header.trim().split(/\s+/);
  const scheme = parts[0];
  const token = parts[1];
  if (parts.length !== 2 || scheme?.toLowerCase() !== "bearer" || !token) {
    throw new UnauthorizedError("Expected Authorization: Bearer <token>");
  }

  const payload = verifyAuthToken(token);

  // Sprint 11 + 18: one DB read fetches reportIds (for matrix access checks)
  // plus the L7/L8 flags (level, isSuperAdmin, canManageUsers) — middleware-
  // resolved so downstream code never re-queries them. Staff still get an
  // empty reportIds set for type-stable use in canAccessTask.
  const userRow = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      level: true,
      isSuperAdmin: true,
      canManageUsers: true,
      reports: { select: { id: true } },
    },
  });
  if (!userRow) {
    throw new UnauthorizedError("User no longer exists");
  }

  req.user = {
    id: payload.sub,
    orgId: payload.orgId,
    role: payload.role,
    reportIds: new Set(userRow.reports.map((r) => r.id)),
    isSuperAdmin: userRow.isSuperAdmin,
    canManageUsers: userRow.canManageUsers,
    level: userRow.level,
  };
  next();
}
