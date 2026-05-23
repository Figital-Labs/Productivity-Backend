import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { truncateNotesForContext } from "../lib/notes-context.js";
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
  type SubmitImageInput,
} from "../schemas/image-extraction.schema.js";
import { formatDateYmd, parseDateString, promptDateAnchors, todayInUserTz } from "../utils/date.js";

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
  input: SubmitImageInput = {},
): Promise<ImageProcessResult> {
  const today = input.targetDate
    ? parseDateString(input.targetDate)
    : todayInUserTz(DEFAULT_TIMEZONE);

  const pending = await taskRepo.listPending(user.id, PENDING_CONTEXT_LIMIT);
  const taskContext: PendingTaskContext[] = pending.map((t) => {
    const notesForContext = truncateNotesForContext(t.notes);
    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      targetDate: formatDateYmd(t.targetDate),
      ...(notesForContext !== undefined && { notes: notesForContext }),
    };
  });

  // Create empty row first so created tasks can carry sourceId = this row's id.
  // Atomicity intentionally skipped for POC (matches the voice flow).
  const extraction = await imageRepo.create({
    userId: user.id,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildImageExtractionPrompt({
      pendingTasks: taskContext,
      ...promptDateAnchors(today),
    }),
    schema: imageExtractionResponseSchema,
    media: [{ mimeType: image.mimeType, buffer: image.buffer }],
  });

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
