import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { truncateNotesForContext } from "../lib/notes-context.js";
import { buildVoiceIntentPrompt, type PendingTaskContext } from "../lib/prompts/voice-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import * as voiceRepo from "../repositories/voice.repository.js";
import {
  voiceIntentResponseSchema,
  type SubmitVoiceInput,
  type VoiceIntentResponse,
  type VoiceRecommendation,
} from "../schemas/voice-intent.schema.js";
import { formatDateYmd, parseDateString, promptDateAnchors, todayInUserTz } from "../utils/date.js";

import { dispatchAiAction, type PersistedAiAction } from "./action-dispatch.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const PENDING_CONTEXT_LIMIT = 50;

export interface AudioInput {
  buffer: Buffer;
  mimeType: string;
}

export interface VoiceProcessResult {
  voiceInteractionId: string;
  transcript: string;
  actions: PersistedAiAction[];
  recommendations: VoiceRecommendation[];
}

export async function processVoice(
  user: AuthenticatedUser,
  audio: AudioInput,
  input: SubmitVoiceInput = {},
): Promise<VoiceProcessResult> {
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
  // Atomicity is intentionally skipped for POC (ADR / sprint plan); if Vertex fails or
  // an individual dispatch throws, the empty row is left behind. Revisit if it bites.
  const interaction = await voiceRepo.create({
    userId: user.id,
    transcript: "",
    actions: [] as InputJsonValue,
    recommendations: [] as InputJsonValue,
  });

  const aiResponse = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildVoiceIntentPrompt({
      pendingTasks: taskContext,
      ...promptDateAnchors(today),
    }),
    schema: voiceIntentResponseSchema,
    media: [{ mimeType: audio.mimeType, buffer: audio.buffer }],
  });

  const persistedActions: PersistedAiAction[] = [];
  for (const action of aiResponse.actions) {
    persistedActions.push(
      await dispatchAiAction(user, action, {
        sourceType: "voice",
        sourceId: interaction.id,
        today,
      }),
    );
  }

  await voiceRepo.update(interaction.id, {
    transcript: aiResponse.transcript,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  });

  return {
    voiceInteractionId: interaction.id,
    transcript: aiResponse.transcript,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  };
}

export type { VoiceIntentResponse };
