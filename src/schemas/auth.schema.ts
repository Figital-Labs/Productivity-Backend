import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .max(320)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

export const signupSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(72),
  // Sprint 11: signup lets the user pick staff vs manager (POC convenience —
  // production would gate manager creation to admins or org owners). Defaults
  // to staff when omitted, preserving prior behavior.
  role: z.enum(["staff", "manager"]).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;
