import type { Request, Response } from "express";

import { searchUsersQuerySchema, workingHoursSchema } from "../schemas/users.schema.js";
import * as usersService from "../services/users.service.js";

export async function searchUsers(req: Request, res: Response): Promise<void> {
  const query = searchUsersQuerySchema.parse(req.query);
  const users = await usersService.searchSameOrg(req.user, query);
  res.status(200).json(users);
}

export async function updateWorkingHours(req: Request, res: Response): Promise<void> {
  const input = workingHoursSchema.parse(req.body);
  const result = await usersService.updateWorkingHours(req.user, input);
  res.status(200).json(result);
}
