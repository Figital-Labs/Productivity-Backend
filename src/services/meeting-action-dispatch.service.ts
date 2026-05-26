import * as taskRepo from "../repositories/task.repository.js";
import type { TaskSourceType } from "../repositories/task.repository.js";
import type { MeetingAction, MeetingRecommendation } from "../schemas/meeting.schema.js";
import { parseDateString } from "../utils/date.js";

// Declared as a `type` (not `interface`) so it satisfies Prisma's
// `InputJsonValue` shape when serialized into Meeting.actions. Interfaces
// are open for declaration merging and lack an index signature, which
// Prisma's `InputJsonObject` requires. Same pattern as `PersistedDelegationAction`
// in team-action-dispatch.service.ts.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type PersistedMeetingAction = {
  type: "created";
  taskId: string;
  title: string;
  assigneeId: string;
  notes?: string;
  priority?: "low" | "medium" | "high";
  targetDate?: string;
  reasoning: string;
};

export interface MeetingContext {
  /** Meeting id — used as the Task.sourceId for traceability. */
  meetingId: string;
  /** Meeting creator — becomes the Task.creatorId. */
  creatorId: string;
  /** Attendee id allow-list — assignee MUST be one of these or `creatorId`. */
  allowedAssigneeIds: ReadonlySet<string>;
  /** Fallback target date when the AI didn't include one on the action. */
  today: Date;
}

const MEETING_SOURCE_TYPE: TaskSourceType = "meeting" as TaskSourceType;

/**
 * Sprint 15: dispatches a single AI-emitted meeting action. The meeting
 * creator is the Task.creatorId; assignee comes from the action (validated
 * to be in the meeting's attendees or the creator themselves). Hallucinated
 * assignee ids are routed back as a synthetic recommendation, not trusted.
 *
 * Mirrors `team-action-dispatch.service.ts` but uses meeting attendees as
 * the directory instead of `manager.reportIds`.
 */
export async function dispatchMeetingAction(
  action: MeetingAction,
  ctx: MeetingContext,
): Promise<
  | { kind: "action"; action: PersistedMeetingAction }
  | { kind: "recommendation"; recommendation: MeetingRecommendation }
> {
  const isSelf = action.assigneeId === ctx.creatorId;
  const isAttendee = ctx.allowedAssigneeIds.has(action.assigneeId);
  if (!isSelf && !isAttendee) {
    return {
      kind: "recommendation",
      recommendation: {
        title: action.title,
        reasoning: `Assignee id "${action.assigneeId}" was not in the meeting attendees — please assign manually.`,
        ...(action.priority !== undefined && { priority: action.priority }),
        ...(action.targetDate !== undefined && { targetDate: action.targetDate }),
      },
    };
  }

  const targetDate = action.targetDate ? parseDateString(action.targetDate) : ctx.today;
  const created = await taskRepo.create({
    assigneeId: action.assigneeId,
    creatorId: ctx.creatorId,
    title: action.title,
    targetDate,
    sourceType: MEETING_SOURCE_TYPE,
    sourceId: ctx.meetingId,
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
