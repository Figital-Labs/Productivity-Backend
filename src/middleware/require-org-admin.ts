import type { Request, Response, NextFunction } from "express";

import { isOrgAdmin } from "../lib/access.js";
import { ForbiddenError } from "../lib/errors.js";

/**
 * Account-management gate. Only org admins (level >= 800) and the cross-org
 * root may create/edit users, reset passwords, or change the reporting tree.
 * Plain managers (group leads / dept heads) manage their reports operationally
 * (see tasks, delegate) but do NOT own accounts. Mount AFTER jwtAuth and
 * requireManager so `req.user` is populated.
 */
export function requireOrgAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user.isSuperAdmin && !isOrgAdmin(req.user.level)) {
    throw new ForbiddenError("Only admins can manage user accounts");
  }
  next();
}
