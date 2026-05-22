import { ConflictError, UnauthorizedError } from "../lib/errors.js";
import { signAuthToken } from "../lib/jwt.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as userRepo from "../repositories/user.repository.js";
import type { LoginInput, SignupInput } from "../schemas/auth.schema.js";

const DEFAULT_ORG_ID = "demo-org";
const DEFAULT_ROLE: AuthenticatedUser["role"] = "staff";

export interface PublicAuthUser {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: AuthenticatedUser["role"];
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

function toPublicUser(user: userRepo.User): PublicAuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    orgId: user.orgId,
    role: toAuthRole(user.role),
  };
}

function buildAuthResponse(user: userRepo.User): AuthResponse {
  const publicUser = toPublicUser(user);
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
    role: DEFAULT_ROLE,
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
