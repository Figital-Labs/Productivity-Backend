import { AI_THINKING_BUDGET, AI_TIMEOUT_MS, modelFor, temperatureFor } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { truncateNotesForContext } from "../lib/notes-context.js";
import { buildVoiceIntentPrompt, type PendingTaskContext } from "../lib/prompts/voice-intent.js";
import { generateStructured } from "../lib/vertex.js";
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

/**
 * Consumer side of voice capture (async pipeline, ADR-0025). The clip already lives in S3 and the
 * `VoiceInteraction` row was pre-created at enqueue (holding the audio key) — this runs in the
 * pg-boss worker: it downloads context, runs Vertex extraction, dispatches the high-confidence
 * actions into real tasks (sourceId = the interaction row), and fills the row with
 * transcript/actions/recommendations. No S3 write here — the presigned upload is the source of
 * truth, so a storage hiccup can't happen at this stage.
 */
export async function runVoiceProcessing(
  user: AuthenticatedUser,
  audio: AudioInput,
  input: SubmitVoiceInput,
  interactionId: string,
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
    model: modelFor("extraction"),
    prompt: buildVoiceIntentPrompt({
      pendingTasks: taskContext,
      ...promptDateAnchors(today),
    }),
    schema: voiceIntentResponseSchema,
    media: [{ mimeType: audio.mimeType, buffer: audio.buffer }],
    temperature: temperatureFor("extraction"),
    thinkingBudget: AI_THINKING_BUDGET.extraction,
    timeoutMs: AI_TIMEOUT_MS.media,
    label: "voice",
    onRaw: logRaw("voice", user.id),
  });

  const persistedActions: PersistedAiAction[] = [];
  for (const action of aiResponse.actions) {
    persistedActions.push(
      await dispatchAiAction(user, action, {
        sourceType: "voice",
        sourceId: interactionId,
        today,
      }),
    );
  }

  await voiceRepo.update(interactionId, {
    transcript: aiResponse.transcript,
    actions: persistedActions,
    recommendations: aiResponse.recommendations,
  });
}

export type { VoiceIntentResponse };
