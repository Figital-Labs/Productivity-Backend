import type { Request, Response, NextFunction } from "express";

import { ForbiddenError } from "../lib/errors.js";

/**
 * Sprint 18: gate routes that only the cross-org root can use (creating new
 * organizations, listing all orgs). Org admins are NOT root — they manage
 * their own org only.
 */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user.isSuperAdmin) {
    throw new ForbiddenError("Root permission required.");
  }
  next();
}
