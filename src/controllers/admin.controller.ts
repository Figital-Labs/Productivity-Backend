import type { Request, Response } from "express";

import {
  aiUsageQuerySchema,
  interactionParamsSchema,
  interactionsQuerySchema,
  updateOrgSchema,
} from "../schemas/admin.schema.js";
import { idParamSchema } from "../schemas/common.js";
import { bootstrapAdminSchema, createOrganizationSchema } from "../schemas/organization.schema.js";
import * as adminAudit from "../services/admin-audit.service.js";
import * as orgService from "../services/organization.service.js";

// ── Org management (root-only) ──
export async function listOrgs(_req: Request, res: Response): Promise<void> {
  res.json({ orgs: await adminAudit.listOrgsWithStats() });
}

export async function createOrg(req: Request, res: Response): Promise<void> {
  const input = createOrganizationSchema.parse((req.body as unknown) ?? {});
  res.status(201).json(await orgService.createOrganization(input));
}

/** PATCH /orgs/:id — rename the org and/or set its branding logo (root-only). */
export async function renameOrg(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = updateOrgSchema.parse((req.body as unknown) ?? {});
  res.json(await orgService.updateOrganization(id, input));
}

export async function bootstrapAdmin(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const input = bootstrapAdminSchema.parse((req.body as unknown) ?? {});
  res.status(201).json(await orgService.bootstrapAdmin(id, input));
}

export async function orgDetail(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.json(await adminAudit.getOrgDetail(id));
}

// ── AI audit (root-only) ──
export async function orgAiUsage(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const { days } = aiUsageQuerySchema.parse(req.query);
  res.json(await adminAudit.getOrgAiUsage(id, days));
}

export async function orgInteractions(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const query = interactionsQuerySchema.parse(req.query);
  res.json(
    await adminAudit.listOrgInteractions(id, {
      ...(query.type ? { type: query.type } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    }),
  );
}

export async function interactionDetail(req: Request, res: Response): Promise<void> {
  const { type, id } = interactionParamsSchema.parse(req.params);
  res.json(await adminAudit.getInteractionDetail(type, id));
}
