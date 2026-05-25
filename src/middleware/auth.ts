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

  // Sprint 11: managers + admins get a precomputed reportIds set. Staff get
  // an empty set so canAccessTask's `user.reportIds.has(...)` check is
  // type-stable and trivially false for them.
  let reportIds = new Set<string>();
  if (payload.role === "manager" || payload.role === "admin") {
    const row = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { reports: { select: { id: true } } },
    });
    reportIds = new Set((row?.reports ?? []).map((r) => r.id));
  }

  req.user = {
    id: payload.sub,
    orgId: payload.orgId,
    role: payload.role,
    reportIds,
  };
  next();
}
