import type { Request, Response } from "express";

import { idParamSchema } from "../schemas/common.js";
import { bootstrapAdminSchema, createOrganizationSchema } from "../schemas/organization.schema.js";
import * as orgService from "../services/organization.service.js";

export async function list(req: Request, res: Response): Promise<void> {
  res.json({ orgs: await orgService.listOrganizations(req.user) });
}

export async function create(req: Request, res: Response): Promise<void> {
  const input = createOrganizationSchema.parse(req.body);
  res.status(201).json(await orgService.createOrganization(input));
}

export async function bootstrapAdmin(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = bootstrapAdminSchema.parse(req.body);
  res.status(201).json(await orgService.bootstrapAdmin(id, input));
}
