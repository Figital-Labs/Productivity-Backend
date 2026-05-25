/**
 * ⚠️ POC SCOPE ONLY — see ADR-0024.
 *
 * This service projects an activity feed by querying 5–6 tables and merging
 * their rows into a uniform ActivityEvent stream. It is fast at POC scale
 * (~hundreds of tasks per user) and intentionally lossy on state-toggle history
 * (we only see the latest `completed` / `updatedAt`, not every toggle).
 *
 * Migration trigger to a dedicated TaskAuditEvent table:
 *   - >5K tasks per user OR P95 latency > 250ms
 *   - Need for toggle-history fidelity
 *   - Real analytics queries
 *
 * When migrating, the frontend contract (ActivityEvent[]) does NOT change —
 * only this file's internals.
 */

import prisma from "../lib/prisma.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as dayClosureRepo from "../repositories/day-closure.repository.js";
import * as dayPlanRepo from "../repositories/day-plan.repository.js";
import * as imageRepo from "../repositories/image.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import * as textRepo from "../repositories/text-interaction.repository.js";
import * as unifiedRepo from "../repositories/unified-interaction.repository.js";
import * as voiceRepo from "../repositories/voice.repository.js";
import type {
  ActionCounts,
  ActivityActionType,
  ActivityEvent,
  AffectedTask,
  ListActivityQuery,
} from "../schemas/activity.schema.js";
import type { Priority } from "../schemas/common.js";
import { formatDateYmd } from "../utils/date.js";

interface DelegationFields {
  delegatedBy?: { id: string; name: string };
  delegatedTo?: { id: string; name: string };
}

interface PersistedActivityAction {
  type: ActivityActionType;
  taskId?: string;
  title?: string;
}

type TaskTitleLookup = Map<string, string>;

interface ActivityBounds {
  from?: Date;
  to?: Date;
}

const DEFAULT_LOOKBACK_DAYS = 365;

function startOfIstDay(date: string): Date {
  return new Date(`${date}T00:00:00.000+05:30`);
}

function endOfIstDay(date: string): Date {
  return new Date(`${date}T23:59:59.999+05:30`);
}

function activityBounds(query: ListActivityQuery): ActivityBounds {
  if (query.from === undefined && query.to === undefined) {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
    return { from };
  }

  return {
    ...(query.from !== undefined ? { from: startOfIstDay(query.from) } : {}),
    ...(query.to !== undefined ? { to: endOfIstDay(query.to) } : {}),
  };
}

function isPersistedActivityAction(value: unknown): value is PersistedActivityAction {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate["type"] === "created" ||
      candidate["type"] === "completed" ||
      candidate["type"] === "partial" ||
      candidate["type"] === "priority_updated" ||
      candidate["type"] === "target_date_updated") &&
    (candidate["taskId"] === undefined || typeof candidate["taskId"] === "string") &&
    (candidate["title"] === undefined || typeof candidate["title"] === "string")
  );
}

function persistedActions(raw: unknown): PersistedActivityAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPersistedActivityAction);
}

function actionCounts(actions: PersistedActivityAction[]): ActionCounts {
  return actions.reduce<ActionCounts>(
    (counts, action) => ({
      ...counts,
      [action.type]: counts[action.type] + 1,
    }),
    { created: 0, completed: 0, partial: 0, priority_updated: 0, target_date_updated: 0 },
  );
}

function affectedTasks(
  actions: PersistedActivityAction[],
  taskTitles: TaskTitleLookup,
): AffectedTask[] {
  return actions.flatMap((action) => {
    if (action.taskId === undefined) return [];
    const title = taskTitles.get(action.taskId);
    if (title === undefined) return [];
    return [{ id: action.taskId, title, action: action.type }];
  });
}

function nonEmptyField(
  key: "transcript" | "inputText" | "extractedText",
  value: string | null,
): {
  transcript?: string;
  inputText?: string;
  extractedText?: string;
} {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? { [key]: trimmed } : {};
}

function taskSnapshotCount(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0;
}

function hasAiFeedback(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const summary = (raw as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim().length > 0;
}

function taskPriority(value: string | null): Priority | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

export async function listActivity(
  user: AuthenticatedUser,
  query: ListActivityQuery,
): Promise<ActivityEvent[]> {
  const { from, to } = activityBounds(query);

  const [
    voiceInteractions,
    textInteractions,
    imageExtractions,
    unifiedInteractions,
    manualTasks,
    completedTasks,
    dayPlans,
    dayClosures,
  ] = await Promise.all([
    voiceRepo.listInRange(user.id, from, to),
    textRepo.listInRange(user.id, from, to),
    imageRepo.listInRange(user.id, from, to),
    unifiedRepo.listInRange(user.id, from, to),
    taskRepo.listManualCreatedInRange(user.id, from, to),
    taskRepo.listCompletedInRange(user.id, from, to),
    dayPlanRepo.listSubmittedInRange(user.id, from, to),
    dayClosureRepo.listSubmittedInRange(user.id, from, to),
  ]);

  const allActions = [
    ...voiceInteractions.flatMap((row) => persistedActions(row.actions)),
    ...textInteractions.flatMap((row) => persistedActions(row.actions)),
    ...imageExtractions.flatMap((row) => persistedActions(row.actions)),
    ...unifiedInteractions.flatMap((row) => persistedActions(row.actions)),
  ];
  const taskIds = Array.from(
    new Set(
      allActions.map((action) => action.taskId).filter((id): id is string => id !== undefined),
    ),
  );
  const titleRows = await taskRepo.listByIds(user.id, taskIds);
  const taskTitles = new Map(titleRows.map((task) => [task.id, task.title]));

  // Sprint 11: build a delegation lookup for task_created_manual and
  // task_completed events. For each task in the projection, if creator !==
  // assignee, we attach delegatedBy + delegatedTo with the resolved names.
  // The pool of users to resolve: every creator + assignee from manualTasks
  // and completedTasks. Single batched query.
  const delegationTaskIds = [
    ...manualTasks.filter((t) => t.creatorId !== t.assigneeId).map((t) => t.id),
    ...completedTasks.filter((t) => t.creatorId !== t.assigneeId).map((t) => t.id),
  ];
  const userIdsNeedingNames = new Set<string>();
  for (const t of manualTasks) {
    if (t.creatorId !== t.assigneeId) {
      userIdsNeedingNames.add(t.creatorId);
      userIdsNeedingNames.add(t.assigneeId);
    }
  }
  for (const t of completedTasks) {
    if (t.creatorId !== t.assigneeId) {
      userIdsNeedingNames.add(t.creatorId);
      userIdsNeedingNames.add(t.assigneeId);
    }
  }
  const userNameRows =
    userIdsNeedingNames.size > 0
      ? await prisma.user.findMany({
          where: { id: { in: Array.from(userIdsNeedingNames) } },
          select: { id: true, name: true },
        })
      : [];
  const userNames = new Map(userNameRows.map((u) => [u.id, u.name]));

  function delegationFor(task: {
    id: string;
    creatorId: string;
    assigneeId: string;
  }): DelegationFields {
    if (task.creatorId === task.assigneeId) return {};
    if (!delegationTaskIds.includes(task.id)) return {};
    const byName = userNames.get(task.creatorId);
    const toName = userNames.get(task.assigneeId);
    return {
      ...(byName !== undefined && {
        delegatedBy: { id: task.creatorId, name: byName },
      }),
      ...(toName !== undefined && {
        delegatedTo: { id: task.assigneeId, name: toName },
      }),
    };
  }

  const events: ActivityEvent[] = [
    ...voiceInteractions.map((row): ActivityEvent => {
      const actions = persistedActions(row.actions);
      return {
        type: "ai_voice_batch",
        at: row.createdAt.toISOString(),
        interactionId: row.id,
        summary: actionCounts(actions),
        affectedTasks: affectedTasks(actions, taskTitles),
        ...nonEmptyField("transcript", row.transcript),
      };
    }),
    ...textInteractions.map((row): ActivityEvent => {
      const actions = persistedActions(row.actions);
      return {
        type: "ai_text_batch",
        at: row.createdAt.toISOString(),
        interactionId: row.id,
        summary: actionCounts(actions),
        affectedTasks: affectedTasks(actions, taskTitles),
        ...nonEmptyField("inputText", row.inputText),
      };
    }),
    ...imageExtractions.map((row): ActivityEvent => {
      const actions = persistedActions(row.actions);
      return {
        type: "ai_image_batch",
        at: row.createdAt.toISOString(),
        interactionId: row.id,
        summary: actionCounts(actions),
        affectedTasks: affectedTasks(actions, taskTitles),
        ...nonEmptyField("extractedText", row.extractedText),
      };
    }),
    ...unifiedInteractions.map((row): ActivityEvent => {
      const actions = persistedActions(row.actions);
      return {
        type: "ai_unified_batch",
        at: row.createdAt.toISOString(),
        interactionId: row.id,
        summary: actionCounts(actions),
        affectedTasks: affectedTasks(actions, taskTitles),
      };
    }),
    ...manualTasks.map(
      (task): ActivityEvent => ({
        type: "task_created_manual",
        at: task.createdAt.toISOString(),
        task: {
          id: task.id,
          title: task.title,
          priority: taskPriority(task.priority),
        },
        ...delegationFor(task),
      }),
    ),
    ...completedTasks.map(
      (task): ActivityEvent => ({
        type: "task_completed",
        at: task.updatedAt.toISOString(),
        task: {
          id: task.id,
          title: task.title,
        },
        ...delegationFor(task),
      }),
    ),
    ...dayPlans.map(
      (submission): ActivityEvent => ({
        type: "day_plan_submitted",
        at: submission.submittedAt.toISOString(),
        submissionId: submission.id,
        date: formatDateYmd(submission.date),
        taskCount: taskSnapshotCount(submission.taskSnapshot),
      }),
    ),
    ...dayClosures.map(
      (submission): ActivityEvent => ({
        type: "day_closure_submitted",
        at: submission.submittedAt.toISOString(),
        submissionId: submission.id,
        date: formatDateYmd(submission.date),
        hasAiFeedback: hasAiFeedback(submission.aiFeedback),
      }),
    ),
  ];

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
