import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { ValidationError } from "../lib/errors.js";
import {
  buildUnifiedIntentPrompt,
  type PendingTaskContext,
} from "../lib/prompts/unified-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured, type InlineMedia } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import * as unifiedRepo from "../repositories/unified-interaction.repository.js";
import {
  unifiedIntentResponseSchema,
  type SourceModality,
  type UnifiedRecommendation,
} from "../schemas/unified-intent.schema.js";
import { todayInUserTz } from "../utils/date.js";

import { dispatchAiAction, type PersistedAiAction } from "./action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const PENDING_CONTEXT_LIMIT = 50;

export interface ModalityBuffer {
  buffer: Buffer;
  mimeType: string;
}

export interface UnifiedProcessInput {
  audio?: ModalityBuffer | undefined;
  image?: ModalityBuffer | undefined;
  text?: string | undefined;
}

/**
 * The persisted/returned shape for a fusion action. Combines the dispatcher's
 * `PersistedAiAction` with the per-modality `source` tag that came from
 * Gemini's classification. The dispatcher itself doesn't know about source —
 * it's metadata layered on at the service boundary.
 */
export type PersistedUnifiedAction = PersistedAiAction & { source: SourceModality };

export interface UnifiedProcessResult {
  unifiedInteractionId: string;
  actions: PersistedUnifiedAction[];
  recommendations: UnifiedRecommendation[];
}

export async function processUnified(
  user: AuthenticatedUser,
  input: UnifiedProcessInput,
): Promise<UnifiedProcessResult> {
  // Controller validates this too — defense in depth in case any other caller appears.
  if (input.audio === undefined && input.image === undefined && input.text === undefined) {
    throw new ValidationError("At least one of audio, image, or text must be provided.");
  }

  const pending = await taskRepo.listPending(user.id, PENDING_CONTEXT_LIMIT);
  const taskContext: PendingTaskContext[] = pending.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    targetDate: formatDateYMD(t.targetDate),
  }));

  // Empty row first so created tasks can reference it via sourceId.
  // Atomicity intentionally skipped (matches voice/image/closure pattern).
  const interaction = await unifiedRepo.create({
    userId: user.id,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
    ...(input.text !== undefined && { inputText: input.text }),
  });

  const media: InlineMedia[] = [];
  if (input.audio) media.push(input.audio);
  if (input.image) media.push(input.image);

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildUnifiedIntentPrompt({
      pendingTasks: taskContext,
      hasAudio: input.audio !== undefined,
      hasImage: input.image !== undefined,
      text: input.text,
    }),
    schema: unifiedIntentResponseSchema,
    media,
  });

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const persistedActions: PersistedUnifiedAction[] = [];
  for (const action of aiResponse.actions) {
    // Dispatcher takes a VoiceAction-shaped object; UnifiedAction is a structural
    // superset (extra `source` field). Width subtyping makes this safe — the
    // dispatcher just ignores `source` since it's metadata. We re-attach it
    // to the persisted result below for audit + frontend UI hints.
    const persisted = await dispatchAiAction(user, action, {
      sourceType: "unified",
      sourceId: interaction.id,
      today,
    });
    persistedActions.push({ ...persisted, source: action.source });
  }

  await unifiedRepo.update(interaction.id, {
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  });

  return {
    unifiedInteractionId: interaction.id,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  };
}

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
