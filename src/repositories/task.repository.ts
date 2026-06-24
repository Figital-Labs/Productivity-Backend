import type { TaskGetPayload } from "../generated/prisma/models/Task.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

// Exported so the scheduling service can persist slot changes inside its own
// transaction while returning the same `creator`-hydrated payload as every
// other task response.
export const taskWithCreator = {
  include: { creator: { select: { id: true, name: true } } },
} as const;

export type Task = TaskGetPayload<typeof taskWithCreator>;

export type TaskSourceType = "manual" | "voice" | "image" | "text" | "unified";
export type TaskPriority = "low" | "medium" | "high";

export interface CreateTaskData {
  // Sprint 11: callers must supply both ids. For self-created tasks pass
  // the same user id for both. For manager delegation, assignee is the
  // staff member and creator is the manager.
  assigneeId: string;
  creatorId: string;
  title: string;
  targetDate: Date;
  notes?: string;
  priority?: TaskPriority;
  sourceType: TaskSourceType;
  sourceId?: string;
}

export interface UpdateTaskData {
  title?: string | undefined;
  notes?: string | null | undefined;
  priority?: TaskPriority | null | undefined;
  completed?: boolean | undefined;
  isPartial?: boolean | undefined;
  targetDate?: Date | undefined;
}

export function findById(id: string): Promise<Task | null> {
  return prisma.task.findUnique({ ...taskWithCreator, where: { id } });
}

// Sprint 11: param is named `userId` for API stability across the codebase,
// but the underlying filter is now `assigneeId` (the user whose task list
// these tasks belong to). Creator-perspective queries are out of scope here
// — would go in a separate `listCreatedBy(creatorId, ...)` helper if/when
// a "delegated by me" surface lands.

export interface PageOpts {
  limit?: number | undefined;
  offset?: number | undefined;
}

function pageArgs(opts?: PageOpts): { take?: number; skip?: number } {
  return {
    ...(opts?.limit !== undefined ? { take: opts.limit } : {}),
    ...(opts?.offset !== undefined ? { skip: opts.offset } : {}),
  };
}

export function listByDate(userId: string, date: Date, opts?: PageOpts): Promise<Task[]> {
  // Sprint 8 (BUG-004): user-facing list sorts by recency of last edit so the
  // task they just touched floats to top. Previous order was [priority asc,
  // createdAt asc] which left recently-edited tasks buried.
  return prisma.task.findMany({
    ...taskWithCreator,
    where: { assigneeId: userId, targetDate: date, deletedAt: null },
    // `id` tiebreaker keeps optional limit/offset paging stable when tasks
    // share an updatedAt (only affects rows already tied — no visible reorder).
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    ...pageArgs(opts),
  });
}

export function listPending(userId: string, limit: number): Promise<Task[]> {
  // Intentionally NOT changed in Sprint 8. This is the AI-context helper, not
  // user-facing; the AI doesn't care about "recently touched" semantics.
  // Sorted by oldest pending first so when truncated by `limit`, the oldest
  // backlog wins the context budget (more likely to be what a voice note
  // refers to than future-dated work).
  return prisma.task.findMany({
    ...taskWithCreator,
    where: { assigneeId: userId, completed: false, deletedAt: null },
    orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

export function listOpenCarryOver(userId: string, today: Date, opts?: PageOpts): Promise<Task[]> {
  // Sprint 8 (BUG-004): same recency-of-edit ordering as `listByDate`, since
  // carryover is also user-facing (rendered in the "Previous Days" section).
  return prisma.task.findMany({
    ...taskWithCreator,
    where: {
      assigneeId: userId,
      completed: false,
      deletedAt: null,
      targetDate: { lt: today },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    ...pageArgs(opts),
  });
}

export function listByIds(userId: string, ids: string[]): Promise<Task[]> {
  if (ids.length === 0) return Promise.resolve([]);
  // Sprint 11: a user can resolve their own assigned tasks AND tasks they
  // created (delegated to someone else). The activity feed uses this to look
  // up titles for delegated tasks in a manager's AI batch summaries.
  return prisma.task.findMany({
    ...taskWithCreator,
    where: {
      id: { in: ids },
      deletedAt: null,
      OR: [{ assigneeId: userId }, { creatorId: userId }],
    },
  });
}

export function listManualCreatedInRange(userId: string, from?: Date, to?: Date): Promise<Task[]> {
  return prisma.task.findMany({
    ...taskWithCreator,
    where: {
      assigneeId: userId,
      sourceType: "manual",
      deletedAt: null,
      ...(from !== undefined || to !== undefined
        ? {
            createdAt: {
              ...(from !== undefined ? { gte: from } : {}),
              ...(to !== undefined ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export function listCompletedInRange(userId: string, from?: Date, to?: Date): Promise<Task[]> {
  return prisma.task.findMany({
    ...taskWithCreator,
    where: {
      assigneeId: userId,
      completed: true,
      deletedAt: null,
      ...(from !== undefined || to !== undefined
        ? {
            updatedAt: {
              ...(from !== undefined ? { gte: from } : {}),
              ...(to !== undefined ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export function create(data: CreateTaskData): Promise<Task> {
  return prisma.task.create({ ...taskWithCreator, data: omitUndefined(data) });
}

export function update(id: string, patch: UpdateTaskData): Promise<Task> {
  // Sprint 20: keep `completedAt` in lockstep with `completed` for every caller
  // (toggle, AI "completed" action, day-closure status sync) — set on the
  // true-transition, clear on un-complete. Untouched when `completed` is absent.
  const completedAtPatch =
    patch.completed === true
      ? { completedAt: new Date() }
      : patch.completed === false
        ? { completedAt: null }
        : {};
  return prisma.task.update({
    ...taskWithCreator,
    where: { id },
    data: { ...omitUndefined(patch), ...completedAtPatch },
  });
}

export function softDelete(id: string): Promise<Task> {
  return prisma.task.update({
    ...taskWithCreator,
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export function restore(id: string): Promise<Task> {
  return prisma.task.update({
    ...taskWithCreator,
    where: { id },
    data: { deletedAt: null },
  });
}
