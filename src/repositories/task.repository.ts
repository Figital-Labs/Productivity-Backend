import type { TaskModel } from "../generated/prisma/models.js";
import prisma from "../lib/prisma.js";
import { omitUndefined } from "../utils/object.js";

export type Task = TaskModel;

export type TaskSourceType = "manual" | "voice" | "image";
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
}

export function findById(id: string): Promise<Task | null> {
  return prisma.task.findUnique({ where: { id } });
}

export function listByDate(userId: string, date: Date): Promise<Task[]> {
  return prisma.task.findMany({
    where: { userId, targetDate: date, deletedAt: null },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

export function listPending(userId: string, limit: number): Promise<Task[]> {
  return prisma.task.findMany({
    where: { userId, completed: false, deletedAt: null },
    orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    take: limit,
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
