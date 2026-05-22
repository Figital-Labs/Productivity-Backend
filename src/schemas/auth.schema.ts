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
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;
