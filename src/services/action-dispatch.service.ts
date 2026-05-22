import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import type { Priority } from "../schemas/common.js";
import type { VoiceAction } from "../schemas/voice-intent.schema.js";

import * as taskService from "./task.service.js";

/**
 * Shared between voice-intent and image-extraction services (and, eventually,
 * day-closure). Both AI surfaces extract the same action shape — what differs
 * is the source modality. This module converts an AI-classified action into
 * the matching repository call and returns the persisted shape ready for
 * audit serialization.
 *
 * The `VoiceAction` type name is a Sprint-5 artifact; the type is genuinely
 * modality-neutral. Don't rename until at least three callers agree on the
 * new name.
 */

export type AiSourceType = "voice" | "image";

/**
 * The shape we persist into `VoiceInteraction.actions` / `ImageExtraction.actions`
 * and return to the controller. Identical content to the AI's output but with
 * `taskId` resolved on every variant — including `created`, where we use the
 * freshly-created task's id.
 */
export type PersistedAiAction =
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

export interface DispatchOptions {
  sourceType: AiSourceType;
  sourceId: string;
  today: Date;
}

export async function dispatchAiAction(
  user: AuthenticatedUser,
  action: VoiceAction,
  opts: DispatchOptions,
): Promise<PersistedAiAction> {
  switch (action.type) {
    case "created": {
      const created = await taskRepo.create({
        userId: user.id,
        title: action.title,
        targetDate: opts.today,
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
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
