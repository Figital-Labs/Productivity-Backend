import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { UnifiedInteractionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type UnifiedInteraction = UnifiedInteractionModel;

export interface CreateUnifiedInteractionData {
  userId: string;
  actions: InputJsonValue;
  recommendations: InputJsonValue;
  inputText?: string | undefined;
  audioUrl?: string | undefined;
  imageUrl?: string | undefined;
}

export interface UpdateUnifiedInteractionData {
  actions?: InputJsonValue | undefined;
  recommendations?: InputJsonValue | undefined;
  inputText?: string | undefined;
  audioUrl?: string | undefined;
  imageUrl?: string | undefined;
}

export function create(data: CreateUnifiedInteractionData): Promise<UnifiedInteraction> {
  return prisma.unifiedInteraction.create({ data: omitUndefined(data) });
}

export function update(
  id: string,
  patch: UpdateUnifiedInteractionData,
): Promise<UnifiedInteraction> {
  return prisma.unifiedInteraction.update({
    where: { id },
    data: omitUndefined(patch),
  });
}

export function listInRange(userId: string, from?: Date, to?: Date): Promise<UnifiedInteraction[]> {
  return prisma.unifiedInteraction.findMany({
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
