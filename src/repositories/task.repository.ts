import type { TaskModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type Task = TaskModel;

export type TaskSourceType = "manual" | "voice" | "image" | "text" | "unified";
export type TaskPriority = "low" | "medium" | "high";

export interface CreateTaskData {
  userId: string;
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
  return prisma.task.findUnique({ where: { id } });
}

export function listByDate(userId: string, date: Date): Promise<Task[]> {
  // Sprint 8 (BUG-004): user-facing list sorts by recency of last edit so the
  // task they just touched floats to top. Previous order was [priority asc,
  // createdAt asc] which left recently-edited tasks buried.
  return prisma.task.findMany({
    where: { userId, targetDate: date, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export function listPending(userId: string, limit: number): Promise<Task[]> {
  // Intentionally NOT changed in Sprint 8. This is the AI-context helper, not
  // user-facing; the AI doesn't care about "recently touched" semantics.
  // Sorted by oldest pending first so when truncated by `limit`, the oldest
  // backlog wins the context budget (more likely to be what a voice note
  // refers to than future-dated work).
  return prisma.task.findMany({
    where: { userId, completed: false, deletedAt: null },
    orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

export function listOpenCarryOver(userId: string, today: Date): Promise<Task[]> {
  // Sprint 8 (BUG-004): same recency-of-edit ordering as `listByDate`, since
  // carryover is also user-facing (rendered in the "Previous Days" section).
  return prisma.task.findMany({
    where: { userId, completed: false, deletedAt: null, targetDate: { lt: today } },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export function create(data: CreateTaskData): Promise<Task> {
  return prisma.task.create({ data: omitUndefined(data) });
}

export function update(id: string, patch: UpdateTaskData): Promise<Task> {
  return prisma.task.update({ where: { id }, data: omitUndefined(patch) });
}

export function softDelete(id: string): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

export function restore(id: string): Promise<Task> {
  return prisma.task.update({
    where: { id },
    data: { deletedAt: null },
  });
}
