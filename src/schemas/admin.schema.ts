import { z } from "zod";

export const interactionTypeEnum = z.enum(["voice", "image", "text", "unified", "meeting"]);

export const aiUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const interactionsQuerySchema = z.object({
  type: interactionTypeEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const interactionParamsSchema = z.object({
  type: interactionTypeEnum,
  id: z.string().min(1),
});

export const renameOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
});
