import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as taskRepo from "../repositories/task.repository.js";
import type { CreateTaskInput, UpdateTaskInput } from "../schemas/task.schema.js";
import { canAccess } from "../utils/auth.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export async function getTask(user: AuthenticatedUser, id: string): Promise<taskRepo.Task> {
  const task = await taskRepo.findById(id);
  if (!task) throw new NotFoundError("Task", id);
  if (task.deletedAt !== null) throw new NotFoundError("Task", id);
  if (!canAccess(user, task)) throw new ForbiddenError();
  return task;
}

export function listTasks(user: AuthenticatedUser, dateStr?: string): Promise<taskRepo.Task[]> {
  const date = dateStr ? parseDateString(dateStr) : todayInUserTz(DEFAULT_TIMEZONE);
  return taskRepo.listByDate(user.id, date);
}

export function createTask(
  user: AuthenticatedUser,
  input: CreateTaskInput,
): Promise<taskRepo.Task> {
  const targetDate = input.targetDate
    ? parseDateString(input.targetDate)
    : todayInUserTz(DEFAULT_TIMEZONE);

  return taskRepo.create({
    userId: user.id,
    title: input.title,
    targetDate,
    sourceType: "manual",
    ...(input.notes !== undefined && { notes: input.notes }),
    ...(input.priority !== undefined && { priority: input.priority }),
  });
}

export async function updateTask(
  user: AuthenticatedUser,
  id: string,
  patch: UpdateTaskInput,
): Promise<taskRepo.Task> {
  await getTask(user, id);
  const { targetDate, ...rest } = patch;
  return taskRepo.update(id, {
    ...rest,
    ...(targetDate !== undefined && { targetDate: parseDateString(targetDate) }),
  });
}

export async function deleteTask(user: AuthenticatedUser, id: string): Promise<taskRepo.Task> {
  const task = await taskRepo.findById(id);
  if (!task) throw new NotFoundError("Task", id);
  if (!canAccess(user, task)) throw new ForbiddenError();
  if (task.deletedAt !== null) {
    throw new ConflictError("TASK_ALREADY_DELETED", `Task ${id} is already deleted`);
  }
  return taskRepo.softDelete(id);
}

export async function restoreTask(user: AuthenticatedUser, id: string): Promise<taskRepo.Task> {
  const task = await taskRepo.findById(id);
  if (!task) throw new NotFoundError("Task", id);
  if (!canAccess(user, task)) throw new ForbiddenError();
  if (task.deletedAt === null) {
    throw new ConflictError("TASK_NOT_DELETED", `Task ${id} is not deleted`);
  }
  return taskRepo.restore(id);
}
