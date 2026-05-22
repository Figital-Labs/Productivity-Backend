import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import {
  buildImageExtractionPrompt,
  type PendingTaskContext,
} from "../lib/prompts/image-extraction.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as imageRepo from "../repositories/image.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import {
  imageExtractionResponseSchema,
  type ImageRecommendation,
} from "../schemas/image-extraction.schema.js";
import { todayInUserTz } from "../utils/date.js";

import { dispatchAiAction, type PersistedAiAction } from "./action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const PENDING_CONTEXT_LIMIT = 50;

export interface ImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface ImageProcessResult {
  imageExtractionId: string;
  extractedText: string;
  actions: PersistedAiAction[];
  recommendations: ImageRecommendation[];
}

export async function processImage(
  user: AuthenticatedUser,
  image: ImageInput,
): Promise<ImageProcessResult> {
  const pending = await taskRepo.listPending(user.id, PENDING_CONTEXT_LIMIT);
  const taskContext: PendingTaskContext[] = pending.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    targetDate: formatDateYMD(t.targetDate),
  }));

  // Create empty row first so created tasks can carry sourceId = this row's id.
  // Atomicity intentionally skipped for POC (matches the voice flow).
  const extraction = await imageRepo.create({
    userId: user.id,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildImageExtractionPrompt(taskContext),
    schema: imageExtractionResponseSchema,
    media: [{ mimeType: image.mimeType, buffer: image.buffer }],
  });

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const persistedActions: PersistedAiAction[] = [];
  for (const action of aiResponse.actions) {
    persistedActions.push(
      await dispatchAiAction(user, action, {
        sourceType: "image",
        sourceId: extraction.id,
        today,
      }),
    );
  }

  await imageRepo.update(extraction.id, {
    extractedText: aiResponse.extractedText,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  });

  return {
    imageExtractionId: extraction.id,
    extractedText: aiResponse.extractedText,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  };
}

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
