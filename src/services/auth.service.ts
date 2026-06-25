import { capabilitiesFor, type Capabilities } from "../lib/access.js";
import { ConflictError, UnauthorizedError } from "../lib/errors.js";
import { signAuthToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import prisma from "../lib/prisma.js";
import { resolveScope } from "../lib/resolve-scope.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as userRepo from "../repositories/user.repository.js";
import type { LoginInput, SignupInput } from "../schemas/auth.schema.js";

const DEFAULT_ORG_ID = "demo-org";
const DEFAULT_ROLE: AuthenticatedUser["role"] = "staff";

export interface PublicAuthUser {
  id: string;
  email: string;
  name: string;
  designation: string | null;
  orgId: string;
  role: AuthenticatedUser["role"];
  // Sprint 19: surfaced so the day-timeline knows the user's schedulable window
  // (and tz for the now-line) without an extra round-trip.
  timezone: string;
  workStartMinute: number;
  workEndMinute: number;
  // Authorization: numeric level + derived capabilities. The frontend gates on
  // these, NOT on the role string.
  level: number;
  capabilities: Capabilities;
  // Cross-org root. Drives the super-admin platform portal on the FE.
  isSuperAdmin: boolean;
}

export interface AuthResponse {
  token: string;
  user: PublicAuthUser;
}

function toAuthRole(role: string): AuthenticatedUser["role"] {
  if (role === "staff" || role === "manager" || role === "admin") {
    return role;
  }
  throw new UnauthorizedError("Invalid user role");
}

async function toPublicUser(user: userRepo.User): Promise<PublicAuthUser> {
  // Build the authenticated-user shape resolveScope needs (reports drive the
  // "manages someone" relationship signal), then derive capabilities from
  // level + that scope.
  const withReports = await prisma.user.findUnique({
    where: { id: user.id },
    select: { reports: { select: { id: true } } },
  });
  const authUser: AuthenticatedUser = {
    id: user.id,
    orgId: user.orgId,
    role: toAuthRole(user.role),
    reportIds: new Set((withReports?.reports ?? []).map((r) => r.id)),
    isSuperAdmin: user.isSuperAdmin,
    canManageUsers: user.canManageUsers,
    level: user.level,
  };
  const scope = await resolveScope(authUser);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    designation: user.designation,
    orgId: user.orgId,
    role: toAuthRole(user.role),
    timezone: user.timezone,
    workStartMinute: user.workStartMinute,
    workEndMinute: user.workEndMinute,
    level: user.level,
    capabilities: capabilitiesFor(user.level, scope),
    isSuperAdmin: user.isSuperAdmin,
  };
}

async function buildAuthResponse(user: userRepo.User): Promise<AuthResponse> {
  const publicUser = await toPublicUser(user);
  return {
    token: signAuthToken({
      sub: publicUser.id,
      orgId: publicUser.orgId,
      role: publicUser.role,
    }),
    user: publicUser,
  };
}

export async function signup(input: SignupInput): Promise<AuthResponse> {
  const existing = await userRepo.findByEmail(input.email);
  if (existing) {
    throw new ConflictError("USER_ALREADY_EXISTS", "A user with this email already exists.");
  }

  const user = await userRepo.create({
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
    orgId: DEFAULT_ORG_ID,
    role: input.role ?? DEFAULT_ROLE,
  });

  return buildAuthResponse(user);
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await userRepo.findByEmail(input.email);
  if (!user) {
    throw new UnauthorizedError("Invalid email or password");
  }

  const validPassword = await verifyPassword(input.password, user.passwordHash);
  if (!validPassword) {
    throw new UnauthorizedError("Invalid email or password");
  }

  return buildAuthResponse(user);
}

export async function me(userId: string): Promise<PublicAuthUser> {
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }
  return toPublicUser(user);
}
