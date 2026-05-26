import type { Request, Response } from "express";

import { searchUsersQuerySchema } from "../schemas/users.schema.js";
import * as usersService from "../services/users.service.js";

export async function searchUsers(req: Request, res: Response): Promise<void> {
  const query = searchUsersQuerySchema.parse(req.query);
  const users = await usersService.searchSameOrg(req.user, query);
  res.status(200).json(users);
}
