import { ConflictError } from "../lib/errors.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as dayPlanRepo from "../repositories/day-plan.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import type {
  GetDayPlanQuery,
  SubmitDayPlanInput,
  TaskSnapshotEntry,
} from "../schemas/day-plan.schema.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function snapshotTasks(
  tasks: Awaited<ReturnType<typeof taskRepo.listByDate>>,
): TaskSnapshotEntry[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    isPartial: t.isPartial,
    targetDate: formatDateYMD(t.targetDate),
    ...(t.priority !== null && { priority: t.priority }),
    ...(t.notes !== null && { notes: t.notes }),
  }));
}

export async function submitDayPlan(
  user: AuthenticatedUser,
  input: SubmitDayPlanInput,
): Promise<dayPlanRepo.DayPlanSubmission> {
  const date = input.date ? parseDateString(input.date) : todayInUserTz(DEFAULT_TIMEZONE);

  const existing = await dayPlanRepo.findByUserAndDate(user.id, date);
  if (existing) {
    throw new ConflictError(
      "DAY_PLAN_ALREADY_SUBMITTED",
      `Day plan for ${formatDateYMD(date)} is already submitted.`,
    );
  }

  const tasks = await taskRepo.listByDate(user.id, date);
  return dayPlanRepo.create({
    userId: user.id,
    date,
    taskSnapshot: snapshotTasks(tasks),
  });
}

export function getDayPlan(
  user: AuthenticatedUser,
  query: GetDayPlanQuery,
): Promise<dayPlanRepo.DayPlanSubmission | null> {
  return dayPlanRepo.findByUserAndDate(user.id, parseDateString(query.date));
}
