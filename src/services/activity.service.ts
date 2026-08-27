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
import { resolveScope } from "../lib/resolve-scope.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import type {
  ActionCounts,
  ActivityActionType,
  ActivityEvent,
  AffectedTask,
  ListActivityQuery,
} from "../schemas/activity.schema.js";
import type { Priority } from "../schemas/common.js";
import { formatDateYmd } from "../utils/date.js";

import { userIdsInScope } from "./dashboard-rollup.service.js";

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

interface PersistedMeetingActionLite {
  title: string;
  assigneeId: string;
}

function persistedMeetingActions(raw: unknown): PersistedMeetingActionLite[] {
  if (!Array.isArray(raw)) return [];
  const out: PersistedMeetingActionLite[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const obj = candidate as Record<string, unknown>;
    if (typeof obj["title"] === "string" && typeof obj["assigneeId"] === "string") {
      out.push({ title: obj["title"], assigneeId: obj["assigneeId"] });
    }
  }
  return out;
}

function persistedMeetingRecommendationTitles(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const title = (candidate as Record<string, unknown>)["title"];
    if (typeof title === "string") out.push(title);
  }
  return out;
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

export interface ActivityPage {
  events: ActivityEvent[];
  // ISO timestamp to pass as the next `cursor`, or null when the feed is
  // exhausted (the page came back shorter than the requested limit).
  nextCursor: string | null;
}

const DEFAULT_PAGE_SIZE = 30;

// Runs a query only when its event family is wanted for this `kind`; otherwise
// resolves to an empty array. Keeps the 9-stream fan-out parallel and typed.
function emptyIfSkipped<T>(wanted: boolean, run: () => Promise<T[]>): Promise<T[]> {
  return wanted ? run() : Promise.resolve([]);
}

// Time window shared by every stream: the from/to bounds plus the strictly-
// older pagination cursor. Each stream filters its own timestamp field by this.
interface TimeWindow {
  gte?: Date;
  lte?: Date;
  lt?: Date;
}

export async function listActivity(
  user: AuthenticatedUser,
  query: ListActivityQuery,
): Promise<ActivityPage> {
  const { from, to } = activityBounds(query);
  const kind = query.kind ?? "all";
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = query.cursor !== undefined ? new Date(query.cursor) : undefined;
  const wantMeetings = kind === "all" || kind === "meetings";
  const wantOthers = kind === "all" || kind === "tasks";

  const window: TimeWindow = {
    ...(from !== undefined ? { gte: from } : {}),
    ...(to !== undefined ? { lte: to } : {}),
    ...(cursor !== undefined ? { lt: cursor } : {}),
  };

  const scopedUserIds =
    query.scope === "team" || query.scope === "org"
      ? await userIdsInScope(await resolveScope(user))
      : [user.id];

  const [
    voiceInteractions,
    textInteractions,
    imageExtractions,
    unifiedInteractions,
    manualTasks,
    completedTasks,
    dayPlans,
    dayClosures,
    processedMeetings,
  ] = await Promise.all([
    emptyIfSkipped(wantOthers, () =>
      prisma.voiceInteraction.findMany({
        where: { userId: { in: scopedUserIds }, createdAt: window },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.textInteraction.findMany({
        where: { userId: { in: scopedUserIds }, createdAt: window },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.imageExtraction.findMany({
        where: { userId: { in: scopedUserIds }, createdAt: window },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.unifiedInteraction.findMany({
        where: { userId: { in: scopedUserIds }, createdAt: window },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.task.findMany({
        include: { creator: { select: { id: true, name: true } } },
        where: {
          sourceType: "manual",
          deletedAt: null,
          OR: [{ assigneeId: { in: scopedUserIds } }, { creatorId: { in: scopedUserIds } }],
          createdAt: window,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.task.findMany({
        include: { creator: { select: { id: true, name: true } } },
        where: {
          completed: true,
          deletedAt: null,
          OR: [{ assigneeId: { in: scopedUserIds } }, { creatorId: { in: scopedUserIds } }],
          updatedAt: window,
        },
        orderBy: { updatedAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.dayPlanSubmission.findMany({
        where: { userId: { in: scopedUserIds }, submittedAt: window },
        orderBy: { submittedAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantOthers, () =>
      prisma.dayClosureSubmission.findMany({
        where: {
          userId: { in: scopedUserIds },
          // Sprint 17 Phase 5: the activity feed surfaces real events. A
          // draft is not an event — it's an in-progress UI state.
          status: "submitted",
          submittedAt: window,
        },
        orderBy: { submittedAt: "desc" },
        take: limit,
      }),
    ),
    emptyIfSkipped(wantMeetings, () =>
      prisma.meeting.findMany({
        where: {
          deletedAt: null,
          processedAt: { not: null, ...window },
          OR: [{ userId: { in: scopedUserIds } }, { attendeeIds: { hasSome: scopedUserIds } }],
        },
        orderBy: { processedAt: "desc" },
        take: limit,
      }),
    ),
  ]);

  const externalAttendeeNamesOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap((e) => {
          const name = (e as { name?: unknown } | null)?.name;
          return typeof name === "string" && name.trim().length > 0 ? [name] : [];
        })
      : [];

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
  const titleRows =
    taskIds.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: taskIds }, deletedAt: null },
          select: { id: true, title: true },
        })
      : [];
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
  // Sprint 15: meeting attendees + per-action assignees both need name
  // resolution for the rich `meeting_processed` projection.
  for (const meeting of processedMeetings) {
    // The owner needs a name too, not just the attendees — the feed labels the event with it.
    userIdsNeedingNames.add(meeting.userId);
    for (const attendeeId of meeting.attendeeIds) userIdsNeedingNames.add(attendeeId);
    for (const action of persistedMeetingActions(meeting.actions)) {
      userIdsNeedingNames.add(action.assigneeId);
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
    ...processedMeetings
      // `processedAt` is non-null because listProcessedInRange filters by
      // processedAt != null. Narrow defensively in case the filter ever drifts.
      .filter((m): m is typeof m & { processedAt: Date } => m.processedAt !== null)
      .map((meeting): ActivityEvent => {
        const actions = persistedMeetingActions(meeting.actions);
        const recoTitles = persistedMeetingRecommendationTitles(meeting.recommendations);
        // Hoisted so the field can be spread conditionally without a non-null assertion:
        // the name is absent if the owner was deleted, and the event stays valid without it.
        const ownerName = userNames.get(meeting.userId);
        return {
          type: "meeting_processed",
          at: meeting.processedAt.toISOString(),
          meetingId: meeting.id,
          title: meeting.title,
          actionItemCount: actions.length,
          recommendationCount: recoTitles.length,
          attendees: meeting.attendeeIds.flatMap((id) => {
            const name = userNames.get(id);
            return name === undefined ? [] : [{ id, name }];
          }),
          externalAttendeeNames: externalAttendeeNamesOf(meeting.externalAttendees),
          ...(ownerName !== undefined && { owner: { id: meeting.userId, name: ownerName } }),
          summary: meeting.summary ?? "",
          actionItems: actions.map((action) => ({
            title: action.title,
            assigneeId: action.assigneeId,
            assigneeName: userNames.get(action.assigneeId) ?? "Attendee",
          })),
          recommendations: recoTitles.map((title) => ({ title })),
        };
      }),
  ];

  // Merge the (per-stream over-fetched) events into one timeline, then slice to
  // the page size. nextCursor is the oldest returned event's timestamp; null
  // when this page is short (no more rows older than it).
  const sorted = events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const page = sorted.slice(0, limit);
  const nextCursor = page.length === limit ? (page[page.length - 1]?.at ?? null) : null;
  return { events: page, nextCursor };
}
