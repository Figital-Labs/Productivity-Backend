import type { Request, Response, NextFunction } from "express";

import { env } from "../config/env.js";

export interface AuthenticatedUser {
  id: string;
  orgId: string;
  role: "staff" | "manager" | "admin";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthenticatedUser;
    }
  }
}

/**
 * Stub auth middleware per ADR-0008. Reads `X-User-Id` header; falls back to
 * env.demoUserId if missing. Always succeeds — real auth comes later.
 * The shape of `req.user` is what real auth will populate, so business code
 * downstream is stable across the swap.
 */
export function stubAuth(req: Request, _res: Response, next: NextFunction): void {
  const headerUserId = req.header("X-User-Id");
  const userId = headerUserId && headerUserId.length > 0 ? headerUserId : env.demoUserId;
  req.user = {
    id: userId,
    orgId: "demo-org",
    role: "staff",
  };
  next();
}
