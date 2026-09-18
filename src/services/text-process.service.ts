import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { AI_THINKING_BUDGET, modelFor, temperatureFor } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { truncateNotesForContext } from "../lib/notes-context.js";
import { buildTextIntentPrompt, type PendingTaskContext } from "../lib/prompts/text-intent.js";
import { generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import * as textInteractionRepo from "../repositories/text-interaction.repository.js";
import { textIntentResponseSchema, type SubmitTextInput } from "../schemas/text-process.schema.js";
import type { VoiceRecommendation } from "../schemas/voice-intent.schema.js";
import { formatDateYmd, parseDateString, promptDateAnchors, todayInUserTz } from "../utils/date.js";

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

  // Create the empty row first so AI-created tasks can carry sourceId = this row's id.
  // Atomicity intentionally skipped for POC (matches voice + image flows).
  const interaction = await textInteractionRepo.create({
    userId: user.id,
    inputText: input.text,
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: modelFor("extraction"),
    prompt: buildTextIntentPrompt({
      pendingTasks: taskContext,
      userText: input.text,
      ...promptDateAnchors(today),
    }),
    schema: textIntentResponseSchema,
    temperature: temperatureFor("extraction"),
    thinkingBudget: AI_THINKING_BUDGET.extraction,
    onRaw: logRaw("text", user.id),
  });

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
