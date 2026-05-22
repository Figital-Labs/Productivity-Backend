import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import type { ImageExtractionModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type ImageExtraction = ImageExtractionModel;

export interface CreateImageExtractionData {
  userId: string;
  actions: InputJsonValue;
  recommendations: InputJsonValue;
  imageUrl?: string | undefined;
  extractedText?: string | undefined;
}

export interface UpdateImageExtractionData {
  extractedText?: string | undefined;
  actions?: InputJsonValue | undefined;
  recommendations?: InputJsonValue | undefined;
  imageUrl?: string | undefined;
}

export function create(data: CreateImageExtractionData): Promise<ImageExtraction> {
  return prisma.imageExtraction.create({ data: omitUndefined(data) });
}

export function update(id: string, patch: UpdateImageExtractionData): Promise<ImageExtraction> {
  return prisma.imageExtraction.update({
    where: { id },
    data: omitUndefined(patch),
  });
}
