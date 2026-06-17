import type { Request, Response, NextFunction } from "express";

import { isManagerLevel } from "../lib/access.js";
import { ForbiddenError } from "../lib/errors.js";

/**
 * Sprint 11: gate for `/team/*` routes. Only managers and admins can call
 * delegation endpoints, see team rollups, or create users. Staff calling any
 * /team/* route hits a 403 FORBIDDEN_ROLE here. Must be mounted AFTER jwtAuth
 * so `req.user` is populated.
 */
export function requireManager(req: Request, _res: Response, next: NextFunction): void {
  if (!isManagerLevel(req.user.level)) {
    throw new ForbiddenError("Only managers can access team endpoints");
  }
  next();
}
