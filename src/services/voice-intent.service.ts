import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace.js";
import { buildVoiceIntentPrompt, type PendingTaskContext } from "../lib/prompts/voice-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import * as voiceRepo from "../repositories/voice.repository.js";
import type { Priority } from "../schemas/common.js";
import {
  voiceIntentResponseSchema,
  type VoiceAction,
  type VoiceIntentResponse,
  type VoiceRecommendation,
} from "../schemas/voice-intent.schema.js";
import { todayInUserTz } from "../utils/date.js";

import * as taskService from "./task.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const PENDING_CONTEXT_LIMIT = 50;

export interface AudioInput {
  buffer: Buffer;
  mimeType: string;
}

/**
 * The action shape we return AND persist. Same as Gemini's output but with
 * `taskId` resolved on every variant — including `created`, where the id is
 * the freshly-created task. This is what the frontend consumes and what we
 * store in `VoiceInteraction.actions` for audit.
 */
export type PersistedVoiceAction =
  | {
      type: "created";
      taskId: string;
      title: string;
      notes?: string;
      priority?: Priority;
      reasoning: string;
    }
  | { type: "priority_updated"; taskId: string; priority: Priority; reasoning: string }
  | { type: "completed"; taskId: string; reasoning: string }
  | { type: "partial"; taskId: string; reasoning: string };

export interface VoiceProcessResult {
  voiceInteractionId: string;
  transcript: string;
  actions: PersistedVoiceAction[];
  recommendations: VoiceRecommendation[];
}

export async function processVoice(
  user: AuthenticatedUser,
  audio: AudioInput,
): Promise<VoiceProcessResult> {
  const pending = await taskRepo.listPending(user.id, PENDING_CONTEXT_LIMIT);
  const taskContext: PendingTaskContext[] = pending.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    targetDate: formatDateYMD(t.targetDate),
  }));

  // Created the empty row first so AI-created tasks can carry sourceId = this row's id.
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
    prompt: buildVoiceIntentPrompt(taskContext),
    schema: voiceIntentResponseSchema,
    media: [{ mimeType: audio.mimeType, buffer: audio.buffer }],
  });

  const today = todayInUserTz(DEFAULT_TIMEZONE);
  const persistedActions: PersistedVoiceAction[] = [];
  for (const action of aiResponse.actions) {
    persistedActions.push(await dispatchAction(user, action, interaction.id, today));
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

async function dispatchAction(
  user: AuthenticatedUser,
  action: VoiceAction,
  sourceId: string,
  today: Date,
): Promise<PersistedVoiceAction> {
  switch (action.type) {
    case "created": {
      const created = await taskRepo.create({
        userId: user.id,
        title: action.title,
        targetDate: today,
        sourceType: "voice",
        sourceId,
        ...(action.notes !== undefined && { notes: action.notes }),
        ...(action.priority !== undefined && { priority: action.priority }),
      });
      return {
        type: "created",
        taskId: created.id,
        title: created.title,
        reasoning: action.reasoning,
        ...(action.notes !== undefined && { notes: action.notes }),
        ...(action.priority !== undefined && { priority: action.priority }),
      };
    }
    case "priority_updated": {
      await taskService.getTask(user, action.taskId);
      await taskRepo.update(action.taskId, { priority: action.priority });
      return {
        type: "priority_updated",
        taskId: action.taskId,
        priority: action.priority,
        reasoning: action.reasoning,
      };
    }
    case "completed": {
      await taskService.getTask(user, action.taskId);
      await taskRepo.update(action.taskId, { completed: true });
      return {
        type: "completed",
        taskId: action.taskId,
        reasoning: action.reasoning,
      };
    }
    case "partial": {
      await taskService.getTask(user, action.taskId);
      await taskRepo.update(action.taskId, { isPartial: true });
      return {
        type: "partial",
        taskId: action.taskId,
        reasoning: action.reasoning,
      };
    }
  }
}

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type { VoiceIntentResponse };
