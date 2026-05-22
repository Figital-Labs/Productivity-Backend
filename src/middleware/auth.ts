import type { Request, Response, NextFunction } from "express";

import { UnauthorizedError } from "../lib/errors.js";
import { verifyAuthToken } from "../lib/jwt.js";

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

export function jwtAuth(req: Request, _res: Response, next: NextFunction): void {
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
  req.user = {
    id: payload.sub,
    orgId: payload.orgId,
    role: payload.role,
  };
  next();
}
