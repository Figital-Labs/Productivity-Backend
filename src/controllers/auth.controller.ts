import type { Request, Response } from "express";

import { loginSchema, signupSchema } from "../schemas/auth.schema.js";
import * as authService from "../services/auth.service.js";

export async function signup(req: Request, res: Response): Promise<void> {
  const input = signupSchema.parse(req.body);
  const result = await authService.signup(input);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.json(result);
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await authService.me(req.user.id);
  res.json({ user });
}
