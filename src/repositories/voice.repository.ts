import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { VoiceInteractionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type VoiceInteraction = VoiceInteractionModel;

export interface CreateVoiceInteractionData {
  userId: string;
  transcript: string;
  actions: InputJsonValue;
  recommendations: InputJsonValue;
  audioUrl?: string | undefined;
}

export interface UpdateVoiceInteractionData {
  transcript?: string | undefined;
  actions?: InputJsonValue | undefined;
  recommendations?: InputJsonValue | undefined;
  audioUrl?: string | undefined;
}

export function create(data: CreateVoiceInteractionData): Promise<VoiceInteraction> {
  return prisma.voiceInteraction.create({ data: omitUndefined(data) });
}

export function update(id: string, patch: UpdateVoiceInteractionData): Promise<VoiceInteraction> {
  return prisma.voiceInteraction.update({
    where: { id },
    data: omitUndefined(patch),
  });
}

export function findById(id: string): Promise<VoiceInteraction | null> {
  return prisma.voiceInteraction.findUnique({ where: { id } });
}

export function listInRange(userId: string, from?: Date, to?: Date): Promise<VoiceInteraction[]> {
  return prisma.voiceInteraction.findMany({
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
