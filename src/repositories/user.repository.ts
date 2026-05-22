import type { UserModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type User = UserModel;

export interface CreateUserData {
  email: string;
  name: string;
  passwordHash: string;
  orgId: string;
  role?: "staff" | "manager" | "admin";
}

export function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export function create(data: CreateUserData): Promise<User> {
  return prisma.user.create({ data: omitUndefined(data) });
}
