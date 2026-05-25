import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import type {
  TeamDelegateAction,
  TeamDelegateRecommendation,
} from "../schemas/team-voice-delegate.schema.js";
import { parseDateString } from "../utils/date.js";

// Declared as a `type` (not `interface`) so it satisfies Prisma's
// `InputJsonValue` shape when serialized into VoiceInteraction.actions /
// TextInteraction.actions / ImageExtraction.actions — interfaces are open
// for declaration merging and lack an index signature, which Prisma's
// `InputJsonObject` requires. The matching personal `PersistedAiAction` in
// `action-dispatch.service.ts` is also a `type` for the same reason.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type PersistedDelegationAction = {
  type: "created";
  taskId: string;
  title: string;
  assigneeId: string;
  notes?: string;
  priority?: "low" | "medium" | "high";
  targetDate?: string;
  reasoning: string;
};

export interface DelegationDispatchOptions {
  sourceType: "voice" | "text" | "image";
  sourceId: string;
  /** Fallback target date when the AI didn't include one on the action. */
  today: Date;
}

/**
 * Sprint 11: dispatches a single AI-emitted delegation action. The manager is
 * the creator; assignee comes from the action (validated to be in the
 * manager's reports or the manager themselves). Hallucinated assignee ids
 * are routed back to the caller as a synthetic recommendation, not trusted.
 */
export async function dispatchDelegationAction(
  manager: AuthenticatedUser,
  action: TeamDelegateAction,
  opts: DelegationDispatchOptions,
): Promise<
  | { kind: "action"; action: PersistedDelegationAction }
  | { kind: "recommendation"; recommendation: TeamDelegateRecommendation }
> {
  const isSelf = action.assigneeId === manager.id;
  const isReport = manager.reportIds.has(action.assigneeId);
  if (!isSelf && !isReport) {
    return {
      kind: "recommendation",
      recommendation: {
        title: action.title,
        reasoning: `Assignee id "${action.assigneeId}" is not in your team — please retry with a clear name.`,
        ...(action.priority !== undefined && { priority: action.priority }),
        ...(action.targetDate !== undefined && { targetDate: action.targetDate }),
      },
    };
  }

  const targetDate = action.targetDate ? parseDateString(action.targetDate) : opts.today;
  const created = await taskRepo.create({
    assigneeId: action.assigneeId,
    creatorId: manager.id,
    title: action.title,
    targetDate,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    ...(action.notes !== undefined && { notes: action.notes }),
    ...(action.priority !== undefined && { priority: action.priority }),
  });

  return {
    kind: "action",
    action: {
      type: "created",
      taskId: created.id,
      title: created.title,
      assigneeId: action.assigneeId,
      reasoning: action.reasoning,
      ...(action.notes !== undefined && { notes: action.notes }),
      ...(action.priority !== undefined && { priority: action.priority }),
      ...(action.targetDate !== undefined && { targetDate: action.targetDate }),
    },
  };
}
