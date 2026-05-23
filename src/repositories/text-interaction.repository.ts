import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { TextInteractionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type TextInteraction = TextInteractionModel;

export interface CreateTextInteractionData {
  userId: string;
  inputText: string;
  actions: InputJsonValue;
  recommendations: InputJsonValue;
}

export interface UpdateTextInteractionData {
  inputText?: string | undefined;
  actions?: InputJsonValue | undefined;
  recommendations?: InputJsonValue | undefined;
}

export function create(data: CreateTextInteractionData): Promise<TextInteraction> {
  return prisma.textInteraction.create({ data: omitUndefined(data) });
}

export function update(id: string, patch: UpdateTextInteractionData): Promise<TextInteraction> {
  return prisma.textInteraction.update({
    where: { id },
    data: omitUndefined(patch),
  });
}

export function listInRange(userId: string, from?: Date, to?: Date): Promise<TextInteraction[]> {
  return prisma.textInteraction.findMany({
    where: {
      userId,
      ...(from !== undefined || to !== undefined
        ? {
            createdAt: {
              ...(from !== undefined ? { gte: from } : {}),
              ...(to !== undefined ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });
}
