/**
 * Sprint 19 — DB orchestration for time-slot scheduling. Loads the assignee's
 * working hours + same-day siblings, runs the pure engine, and persists the
 * result. All multi-row writes happen in one Serializable transaction (with a
 * single retry) so concurrent creates can't double-book the same minute.
 */
import { ForbiddenError, NotFoundError } from "../../lib/errors.js";
import prisma from "../../lib/prisma.js";
import type { AuthenticatedUser } from "../../middleware/auth.js";
import * as taskRepo from "../../repositories/task.repository.js";
import { canAccessTask } from "../../utils/auth.js";

import {
  DEFAULT_DURATION_MINUTES,
  findEarliestFreeSlot,
  placeWithCascade,
  type Slot,
} from "./engine.js";

// Interactive-transaction client type, derived from the (last) `$transaction`
// overload so we never hand-maintain the ITXClientDenyList.
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface SlotRow {
  id: string;
  scheduledStartMinute: number | null;
  scheduledDurationMinutes: number | null;
}

function rowsToSlots(rows: SlotRow[]): Slot[] {
  return rows.flatMap((r) =>
    r.scheduledStartMinute === null
      ? []
      : [
          {
            id: r.id,
            start: r.scheduledStartMinute,
            duration: r.scheduledDurationMinutes ?? DEFAULT_DURATION_MINUTES,
          },
        ],
  );
}

async function workingHoursFor(
  tx: Tx,
  userId: string,
): Promise<{ workStart: number; workEnd: number }> {
  const u = await tx.user.findUnique({
    where: { id: userId },
    select: { workStartMinute: true, workEndMinute: true },
  });
  if (!u) throw new NotFoundError("User", userId);
  return { workStart: u.workStartMinute, workEnd: u.workEndMinute };
}

function scheduledSiblings(tx: Tx, assigneeId: string, targetDate: Date, excludeId: string) {
  return tx.task.findMany({
    where: {
      assigneeId,
      targetDate,
      deletedAt: null,
      scheduledStartMinute: { not: null },
      id: { not: excludeId },
    },
    select: { id: true, scheduledStartMinute: true, scheduledDurationMinutes: true },
  });
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  // P2034 = Prisma write-conflict/deadlock; 40001 = Postgres serialization failure.
  return code === "P2034" || code === "40001";
}

async function runSerializable<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: "Serializable" });
  } catch (err) {
    if (!isRetryable(err)) throw err;
    return prisma.$transaction(fn, { isolationLevel: "Serializable" });
  }
}

/**
 * Auto-assign the earliest free slot to a freshly-created task. Soft-fails:
 * scheduling is a convenience and must never block task creation, so on any
 * error (or a full day) the task is simply left Unscheduled and returned as-is.
 */
export async function autoScheduleOnCreate(task: taskRepo.Task): Promise<taskRepo.Task> {
  try {
    return await runSerializable(async (tx) => {
      const hours = await workingHoursFor(tx, task.assigneeId);
      const siblings = await scheduledSiblings(tx, task.assigneeId, task.targetDate, task.id);
      const start = findEarliestFreeSlot(rowsToSlots(siblings), hours, DEFAULT_DURATION_MINUTES);
      if (start === null) return task; // day full → stays Unscheduled
      return tx.task.update({
        ...taskRepo.taskWithCreator,
        where: { id: task.id },
        data: { scheduledStartMinute: start, scheduledDurationMinutes: DEFAULT_DURATION_MINUTES },
      });
    });
  } catch (err) {
    console.error("[scheduling] auto-schedule failed, leaving task unscheduled:", err);
    return task;
  }
}

export interface ScheduleTaskInput {
  startMinute: number | null;
  durationMinutes?: number | undefined;
}

/**
 * Move/resize a task to an explicit slot (or unschedule it when startMinute is
 * null), cascading any tasks it collides with. Returns the placed task plus the
 * full set of tasks the cascade touched, so the client can reconcile siblings.
 */
export async function scheduleTask(
  user: AuthenticatedUser,
  taskId: string,
  input: ScheduleTaskInput,
): Promise<{ task: taskRepo.Task; affected: taskRepo.Task[] }> {
  const target = await taskRepo.findById(taskId);
  if (!target) throw new NotFoundError("Task", taskId);
  if (target.deletedAt !== null) throw new NotFoundError("Task", taskId);
  if (!(await canAccessTask(user, target))) throw new ForbiddenError();

  if (input.startMinute === null) {
    const task = await runSerializable((tx) =>
      tx.task.update({
        ...taskRepo.taskWithCreator,
        where: { id: taskId },
        data: { scheduledStartMinute: null, scheduledDurationMinutes: null },
      }),
    );
    return { task, affected: [task] };
  }

  const startMinute = input.startMinute;

  return runSerializable(async (tx) => {
    const hours = await workingHoursFor(tx, target.assigneeId);
    const duration =
      input.durationMinutes ?? target.scheduledDurationMinutes ?? DEFAULT_DURATION_MINUTES;
    const siblings = await scheduledSiblings(tx, target.assigneeId, target.targetDate, taskId);

    const result = placeWithCascade(
      rowsToSlots(siblings),
      { id: taskId, start: startMinute, duration },
      hours,
    );

    const task = await tx.task.update({
      ...taskRepo.taskWithCreator,
      where: { id: taskId },
      data: {
        scheduledStartMinute: result.placed.start,
        scheduledDurationMinutes: result.placed.duration,
      },
    });

    const affected: taskRepo.Task[] = [task];
    for (const m of result.moved) {
      affected.push(
        await tx.task.update({
          ...taskRepo.taskWithCreator,
          where: { id: m.id },
          data: { scheduledStartMinute: m.start },
        }),
      );
    }
    for (const id of result.overflow) {
      affected.push(
        await tx.task.update({
          ...taskRepo.taskWithCreator,
          where: { id },
          data: { scheduledStartMinute: null, scheduledDurationMinutes: null },
        }),
      );
    }
    return { task, affected };
  });
}
