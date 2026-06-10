import { AI_TEMPERATURE, AI_THINKING_BUDGET } from "../lib/ai-config.js";
import { logRaw } from "../lib/ai-log.js";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import {
  buildDayClosureFeedbackPrompt,
  type CurrentTaskState,
} from "../lib/prompts/day-closure-feedback.js";
import { resolveScope } from "../lib/resolve-scope.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../lib/vertex.js";
import type { AuthenticatedUser } from "../middleware/auth.js";
import * as dayClosureRepo from "../repositories/day-closure.repository.js";
import * as dayPlanRepo from "../repositories/day-plan.repository.js";
import * as reviewRepo from "../repositories/submission-review.repository.js";
import * as taskRepo from "../repositories/task.repository.js";
import {
  dayClosureFeedbackSchema,
  type DayClosureFeedback,
} from "../schemas/day-closure-feedback.schema.js";
import type {
  GetDayClosureQuery,
  ReviewDayClosureInput,
  SubmitDayClosureInput,
} from "../schemas/day-closure.schema.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

import { userIdsInScope } from "./dashboard-rollup.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/**
 * Sprint 17 review response. The FE rehydrates the review screen from this
 * shape — keep it stable; the same shape is also what `findByUserAndDate`
 * returns when called from the resume path (`GET /day-closure?date=`).
 */
export interface DayClosureReviewResult {
  dayClosureId: string;
  status: "draft" | "submitted";
  reviewedAt: Date | null;
  aiFeedback: DayClosureFeedback;
}

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function currentTaskStateFrom(
  tasks: Awaited<ReturnType<typeof taskRepo.listByDate>>,
): CurrentTaskState[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    isPartial: t.isPartial,
    priority: t.priority,
  }));
}

/**
 * Sprint 17 — Phase 2. Generate AI feedback ONCE for the user's day and
 * persist it as a `status='draft'` row. Idempotent: re-calling on an
 * existing draft returns the stored payload without re-invoking Vertex (D6).
 */
export async function reviewDayClosure(
  user: AuthenticatedUser,
  input: ReviewDayClosureInput,
): Promise<DayClosureReviewResult> {
  const date = input.date ? parseDateString(input.date) : todayInUserTz(DEFAULT_TIMEZONE);
  const dateLabel = formatDateYMD(date);

  const plan = await dayPlanRepo.findByUserAndDate(user.id, date);

  const existing = await dayClosureRepo.findByUserAndDate(user.id, date);
  if (existing) {
    if (existing.status === "submitted") {
      throw new ConflictError(
        "DAY_CLOSURE_ALREADY_SUBMITTED",
        `Day closure for ${dateLabel} is already submitted.`,
      );
    }
    // status === 'draft' → AI already ran; return the stored review verbatim.
    // Explicit re-run is deferred per D6; the seam exists (re-running review
    // would mean deleting the draft first), but we don't expose it yet.
    return {
      dayClosureId: existing.id,
      status: "draft",
      reviewedAt: existing.reviewedAt,
      aiFeedback: existing.aiFeedback as DayClosureFeedback,
    };
  }

  const currentTasks = await taskRepo.listByDate(user.id, date);
  let aiFeedback: DayClosureFeedback;
  try {
    aiFeedback = await generateStructured({
      model: GEMINI_FLASH_MODEL,
      prompt: buildDayClosureFeedbackPrompt({
        todaysTasks: currentTaskStateFrom(currentTasks),
        hasDayPlan: !!plan,
        closureNarrative: input.commentary ?? "",
      }),
      schema: dayClosureFeedbackSchema,
      temperature: AI_TEMPERATURE.dayClosure,
      thinkingBudget: AI_THINKING_BUDGET.dayClosure,
      onRaw: logRaw("day-closure", user.id),
    });
  } catch (err) {
    // Graceful degradation: don't lose the user's closure on an AI hiccup.
    // Reflect the task list deterministically; the narrative-driven auto-marking
    // simply doesn't happen (empty taskActions/additions) but nothing is lost.
    console.error("[day-closure] AI review failed, serving deterministic feedback:", err);
    aiFeedback = {
      achievements: currentTasks.filter((t) => t.completed).map((t) => t.title),
      partial: currentTasks.filter((t) => t.isPartial).map((t) => t.title),
      missed: currentTasks.filter((t) => !t.completed && !t.isPartial).map((t) => t.title),
      additions: [],
      taskActions: [],
      summary: "Couldn't generate a summary just now — here's your list as it stands.",
    };
  }

  // Apply task status updates the AI inferred from the narrative.
  const todayTaskIds = new Set(currentTasks.map((t) => t.id));
  for (const action of aiFeedback.taskActions) {
    if (!todayTaskIds.has(action.taskId)) continue;
    await taskRepo.update(action.taskId, {
      completed: action.status === "completed",
      isPartial: action.status === "partial",
    });
  }

  // Create completed tasks for ad-hoc work mentioned in the narrative.
  for (const title of aiFeedback.additions) {
    const created = await taskRepo.create({
      assigneeId: user.id,
      creatorId: user.id,
      title,
      targetDate: date,
      sourceType: "manual",
      notes: "Extra work noted during day closure review.",
    });
    await taskRepo.update(created.id, { completed: true });
  }

  const draft = await dayClosureRepo.createDraft({
    userId: user.id,
    date,
    aiFeedback,
    narrative: input.commentary ?? "",
  });
  return {
    dayClosureId: draft.id,
    status: "draft",
    reviewedAt: draft.reviewedAt,
    aiFeedback,
  };
}

/**
 * Sprint 17 — Phase 3. Finalize an existing draft. Refuses if no draft
 * exists (the FE must call Review first) or if the date is already
 * submitted. Does NOT regenerate `aiFeedback` — that snapshot was taken at
 * review time and is intentionally point-in-time (D3).
 */
export async function submitDayClosure(
  user: AuthenticatedUser,
  input: SubmitDayClosureInput,
): Promise<dayClosureRepo.DayClosureSubmission> {
  const date = input.date ? parseDateString(input.date) : todayInUserTz(DEFAULT_TIMEZONE);
  const dateLabel = formatDateYMD(date);

  const existing = await dayClosureRepo.findByUserAndDate(user.id, date);
  if (!existing) {
    throw new AppError(
      "DAY_CLOSURE_REVIEW_REQUIRED",
      400,
      `Run review before submitting closure for ${dateLabel}.`,
    );
  }
  if (existing.status === "submitted") {
    throw new ConflictError(
      "DAY_CLOSURE_ALREADY_SUBMITTED",
      `Day closure for ${dateLabel} is already submitted.`,
    );
  }

  return dayClosureRepo.markSubmitted(existing.id, {
    commentary: input.commentary ?? existing.commentary,
  });
}

export function getDayClosure(
  user: AuthenticatedUser,
  query: GetDayClosureQuery,
): Promise<dayClosureRepo.DayClosureSubmission | null> {
  if (query.date === undefined) return Promise.resolve(null);
  // Sprint 17 Phase 5 intentional unfiltered read: the FE needs to be able
  // to resume an in-progress review, so a draft row must come back here.
  return dayClosureRepo.findByUserAndDate(user.id, parseDateString(query.date));
}

function dateDaysAgo(days: number): Date {
  const date = todayInUserTz(DEFAULT_TIMEZONE);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

export async function listUnreviewedClosures(
  reviewer: AuthenticatedUser,
): Promise<dayClosureRepo.DayClosureSubmission[]> {
  const scope = await resolveScope(reviewer);
  const userIds = await userIdsInScope(scope);
  // `listForUsersInDateRange` filters to status='submitted' (Sprint 17
  // Phase 5), so drafts can never appear on a manager's unreviewed list.
  const submissions = await dayClosureRepo.listForUsersInDateRange(
    userIds,
    dateDaysAgo(7),
    todayInUserTz(DEFAULT_TIMEZONE),
  );
  const reviews = await reviewRepo.listForReviewer(
    submissions.map((submission) => submission.id),
    "closure",
    reviewer.id,
  );
  const reviewedIds = new Set(reviews.map((review) => review.submissionId));
  return submissions.filter((submission) => !reviewedIds.has(submission.id));
}

export async function markClosureReviewed(
  reviewer: AuthenticatedUser,
  submissionId: string,
): Promise<reviewRepo.SubmissionReview> {
  const submission = await dayClosureRepo.findById(submissionId);
  if (!submission) throw new NotFoundError("DayClosure", submissionId);
  const scope = await resolveScope(reviewer);
  const userIds = await userIdsInScope(scope);
  if (!userIds.includes(submission.userId)) throw new ForbiddenError();
  const existing = await reviewRepo.findReview(submissionId, "closure", reviewer.id);
  if (existing) {
    throw new ConflictError("SUBMISSION_ALREADY_REVIEWED", "You already reviewed this submission.");
  }
  return reviewRepo.createReview(submissionId, "closure", reviewer.id);
}
