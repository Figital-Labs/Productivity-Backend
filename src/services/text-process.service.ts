import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { buildTextIntentPrompt, type PendingTaskContext } from "../lib/prompts/text-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import * as textInteractionRepo from "../repositories/text-interaction.repository.js";
import { textIntentResponseSchema, type SubmitTextInput } from "../schemas/text-process.schema.js";
import type { VoiceRecommendation } from "../schemas/voice-intent.schema.js";
import { todayInUserTz } from "../utils/date.js";

import { dispatchAiAction, type PersistedAiAction } from "./action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const PENDING_CONTEXT_LIMIT = 50;

export interface TextProcessResult {
  textInteractionId: string;
  actions: PersistedAiAction[];
  recommendations: VoiceRecommendation[];
}

export async function processText(
  user: AuthenticatedUser,
  input: SubmitTextInput,
): Promise<TextProcessResult> {
  const pending = await taskRepo.listPending(user.id, PENDING_CONTEXT_LIMIT);
  const taskContext: PendingTaskContext[] = pending.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    targetDate: formatDateYMD(t.targetDate),
  }));

  // Create the empty row first so AI-created tasks can carry sourceId = this row's id.
  // Atomicity intentionally skipped for POC (matches voice + image flows).
  const interaction = await textInteractionRepo.create({
    userId: user.id,
    inputText: input.text,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildTextIntentPrompt(taskContext, input.text),
    schema: textIntentResponseSchema,
  });

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const persistedActions: PersistedAiAction[] = [];
  for (const action of aiResponse.actions) {
    persistedActions.push(
      await dispatchAiAction(user, action, {
        sourceType: "text",
        sourceId: interaction.id,
        today,
      }),
    );
  }

  await textInteractionRepo.update(interaction.id, {
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  });

  return {
    textInteractionId: interaction.id,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  };
}

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}
