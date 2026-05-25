import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import type { Priority } from "../schemas/common.js";
import type { VoiceAction } from "../schemas/voice-intent.schema.js";
import { parseDateString } from "../utils/date.js";

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

export type AiSourceType = "voice" | "image" | "text" | "unified";

/**
 * The shape we persist into `VoiceInteraction.actions` / `ImageExtraction.actions`
 * and return to the controller. Identical content to the AI's output but with
 * `taskId` resolved on every variant — including `created`, where we use the
 * freshly-created task's id. `targetDate` on created actions reflects the AI's
 * resolution of any relative-date phrase the user used (e.g., "kal" → tomorrow).
 */
export type PersistedAiAction =
  | {
      type: "created";
      taskId: string;
      title: string;
      notes?: string;
      priority?: Priority;
      targetDate?: string;
      reasoning: string;
    }
  | { type: "priority_updated"; taskId: string; priority: Priority; reasoning: string }
  | { type: "completed"; taskId: string; reasoning: string }
  | { type: "partial"; taskId: string; reasoning: string }
  | { type: "target_date_updated"; taskId: string; targetDate: string; reasoning: string };

export interface DispatchOptions {
  sourceType: AiSourceType;
  sourceId: string;
  /**
   * The effective "today" for this dispatch. Used as the default targetDate
   * when the AI didn't supply one on a `created` action. Either the
   * request's `targetDate` (Sprint 8 BUG-002) or `todayInUserTz` fallback.
   */
  today: Date;
  /**
   * Sprint 11: only set by team delegation flows. When a manager dictates
   * "Sneha ko ward 12 visit," the delegation service supplies
   * `creatorId = manager.id` and the AI emits `assigneeId = sneha.id` on the
   * action. For personal flows this is omitted and both sides resolve to
   * `user.id` (the actor is also the assignee and creator).
   */
  creatorId?: string;
}

export async function dispatchAiAction(
  user: AuthenticatedUser,
  action: VoiceAction,
  opts: DispatchOptions,
): Promise<PersistedAiAction> {
  switch (action.type) {
    case "created": {
      // The AI may have resolved a relative-date phrase from user input
      // ("kal", "Friday", "next Monday") into a concrete YYYY-MM-DD. If
      // present, use it. Otherwise fall back to the request's effective
      // today (which is either the frontend-supplied targetDate or the
      // server's todayInUserTz). See BUG-002 + BUG-006 in BUGS.md.
      const targetDate = action.targetDate ? parseDateString(action.targetDate) : opts.today;
      // Sprint 11: when the action carries an assigneeId (delegation flow),
      // use it; otherwise default to the acting user (personal flow). Creator
      // comes from opts.creatorId if the dispatch is a delegation, else
      // mirrors assignee (self-create).
      const assigneeId =
        "assigneeId" in action && typeof action.assigneeId === "string"
          ? action.assigneeId
          : user.id;
      const creatorId = opts.creatorId ?? user.id;
      const created = await taskRepo.create({
        assigneeId,
        creatorId,
        title: action.title,
        targetDate,
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
        ...(action.targetDate !== undefined && { targetDate: action.targetDate }),
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
    case "target_date_updated": {
      await taskService.getTask(user, action.taskId);
      await taskRepo.update(action.taskId, { targetDate: parseDateString(action.targetDate) });
      return {
        type: "target_date_updated",
        taskId: action.taskId,
        targetDate: action.targetDate,
        reasoning: action.reasoning,
      };
    }
  }
}
