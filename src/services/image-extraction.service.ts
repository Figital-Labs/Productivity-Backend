import { AI_TEMPERATURE, AI_THINKING_BUDGET, AI_TIMEOUT_MS } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
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

/**
 * Consumer side of image capture (async pipeline, ADR-0025) — twin of `runVoiceProcessing`. The
 * image already lives in S3 and the `ImageExtraction` row was pre-created at enqueue (holding the
 * image key); the worker downloads the bytes and calls this to run OCR/extraction via Vertex,
 * dispatch the high-confidence actions into real tasks, and fill the row.
 */
export async function runImageProcessing(
  user: AuthenticatedUser,
  image: ImageInput,
  input: SubmitImageInput,
  extractionId: string,
): Promise<void> {
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

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildImageExtractionPrompt({
      pendingTasks: taskContext,
      ...promptDateAnchors(today),
    }),
    schema: imageExtractionResponseSchema,
    media: [{ mimeType: image.mimeType, buffer: image.buffer }],
    temperature: AI_TEMPERATURE.extraction,
    thinkingBudget: AI_THINKING_BUDGET.extraction,
    timeoutMs: AI_TIMEOUT_MS.media,
    label: "image",
    onRaw: logRaw("image", user.id),
  });

  const persistedActions: PersistedAiAction[] = [];
  for (const action of aiResponse.actions) {
    persistedActions.push(
      await dispatchAiAction(user, action, {
        sourceType: "image",
        sourceId: extractionId,
        today,
      }),
    );
  }

  await imageRepo.update(extractionId, {
    extractedText: aiResponse.extractedText,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  });
}
