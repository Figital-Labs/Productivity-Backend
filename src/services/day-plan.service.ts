import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors.js";
import { resolveScope } from "../lib/resolve-scope.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as dayPlanRepo from "../repositories/day-plan.repository.js";
import * as reviewRepo from "../repositories/submission-review.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import type {
  GetDayPlanQuery,
  SubmitDayPlanInput,
  TaskSnapshotEntry,
} from "../schemas/day-plan.schema.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

import { userIdsInScope } from "./dashboard-rollup.service.js";

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
    ...(t.scheduledStartMinute !== null && { scheduledStartMinute: t.scheduledStartMinute }),
    ...(t.scheduledDurationMinutes !== null && {
      scheduledDurationMinutes: t.scheduledDurationMinutes,
    }),
  }));
}

export async function submitDayPlan(
  user: AuthenticatedUser,
  input: SubmitDayPlanInput,
): Promise<dayPlanRepo.DayPlanSubmission> {
  const date = input.date ? parseDateString(input.date) : todayInUserTz(DEFAULT_TIMEZONE);

  // A plan can only be submitted for today (or a past catch-up) — never a future date.
  // The client also hides the button for future dates; this is the server-side guard.
  if (date.getTime() > todayInUserTz(DEFAULT_TIMEZONE).getTime()) {
    throw new ValidationError("You can only submit today's day plan, not a future date.");
  }

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
  if (query.date === undefined) return Promise.resolve(null);
  return dayPlanRepo.findByUserAndDate(user.id, parseDateString(query.date));
}

function dateDaysAgo(days: number): Date {
  const date = todayInUserTz(DEFAULT_TIMEZONE);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

export async function listUnreviewedPlans(
  reviewer: AuthenticatedUser,
): Promise<dayPlanRepo.DayPlanSubmission[]> {
  const scope = await resolveScope(reviewer);
  const userIds = await userIdsInScope(scope);
  const submissions = await dayPlanRepo.listForUsersInDateRange(
    userIds,
    dateDaysAgo(7),
    todayInUserTz(DEFAULT_TIMEZONE),
  );
  const reviews = await reviewRepo.listForReviewer(
    submissions.map((submission) => submission.id),
    "plan",
    reviewer.id,
  );
  const reviewedIds = new Set(reviews.map((review) => review.submissionId));
  return submissions.filter((submission) => !reviewedIds.has(submission.id));
}

export async function markPlanReviewed(
  reviewer: AuthenticatedUser,
  submissionId: string,
): Promise<reviewRepo.SubmissionReview> {
  const submission = await dayPlanRepo.findById(submissionId);
  if (!submission) throw new NotFoundError("DayPlan", submissionId);
  const scope = await resolveScope(reviewer);
  const userIds = await userIdsInScope(scope);
  if (!userIds.includes(submission.userId)) throw new ForbiddenError();
  const existing = await reviewRepo.findReview(submissionId, "plan", reviewer.id);
  if (existing) {
    throw new ConflictError("SUBMISSION_ALREADY_REVIEWED", "You already reviewed this submission.");
  }
  return reviewRepo.createReview(submissionId, "plan", reviewer.id);
}
