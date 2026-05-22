import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

import { env } from "../config/env.js";

import { UnauthorizedError } from "./errors.js";

export interface AuthTokenPayload {
  sub: string;
  orgId: string;
  role: "staff" | "manager" | "admin";
}

export function signAuthToken(payload: AuthTokenPayload): string {
  // `expiresIn` accepts a duration string like "30d" / "24h" or seconds (number).
  // The @types/jsonwebtoken `StringValue` is narrower than `string`, so cast at
  // the boundary — env validation guarantees the value is a non-empty string.
  const opts: SignOptions = { expiresIn: env.jwtTtl as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwtSecret, opts);
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof (decoded as { sub?: unknown }).sub !== "string" ||
    typeof (decoded as { orgId?: unknown }).orgId !== "string" ||
    typeof (decoded as { role?: unknown }).role !== "string"
  ) {
    throw new UnauthorizedError("Invalid token payload");
  }
  const d = decoded as { sub: string; orgId: string; role: string };
  return {
    sub: d.sub,
    orgId: d.orgId,
    role: d.role as AuthTokenPayload["role"],
  };
}
