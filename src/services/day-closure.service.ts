import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
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
import type { GetDayClosureQuery, SubmitDayClosureInput } from "../schemas/day-closure.schema.js";
import type { TaskSnapshotEntry } from "../schemas/day-plan.schema.js";
import type { VoiceRecommendation } from "../schemas/voice-intent.schema.js";
import { parseDateString, todayInUserTz } from "../utils/date.js";

import type { PersistedAiAction } from "./action-dispatch.service.js";
import { userIdsInScope } from "./dashboard-rollup.service.js";
import * as voiceIntentService from "./voice-intent.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";

export interface DayClosureAudioInput {
  buffer: Buffer;
  mimeType: string;
}

export interface DayClosureSubmitResult {
  dayClosureId: string;
  transcript: string;
  taskUpdates: PersistedAiAction[];
  recommendedNewTasks: VoiceRecommendation[];
  aiFeedback: DayClosureFeedback;
}

function formatDateYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function snapshotJsonToTyped(raw: unknown): TaskSnapshotEntry[] {
  return Array.isArray(raw) ? (raw as TaskSnapshotEntry[]) : [];
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

export async function submitDayClosure(
  user: AuthenticatedUser,
  audio: DayClosureAudioInput | undefined,
  input: SubmitDayClosureInput,
): Promise<DayClosureSubmitResult> {
  const date = input.date ? parseDateString(input.date) : todayInUserTz(DEFAULT_TIMEZONE);
  const dateLabel = formatDateYMD(date);

  // Closure is meaningless without a baseline plan to compare against.
  const plan = await dayPlanRepo.findByUserAndDate(user.id, date);
  if (!plan) {
    throw new ConflictError(
      "NO_DAY_PLAN_FOR_DATE",
      `No day plan exists for ${dateLabel}. Submit a plan before closing the day.`,
    );
  }

  const existing = await dayClosureRepo.findByUserAndDate(user.id, date);
  if (existing) {
    throw new ConflictError(
      "DAY_CLOSURE_ALREADY_SUBMITTED",
      `Day closure for ${dateLabel} is already submitted.`,
    );
  }

  // Sprint 10: audio is optional. When the user submits an EOD with text-only
  // commentary (the FE multi-recording flow already ran each clip through
  // `/voice/process`, so all task updates have already landed), skip voice
  // intent entirely — there's nothing left to transcribe or dispatch.
  const voiceResult: Pick<
    voiceIntentService.VoiceProcessResult,
    "transcript" | "actions" | "recommendations"
  > = audio
    ? await voiceIntentService.processVoice(user, audio)
    : { transcript: "", actions: [], recommendations: [] };

  const currentTasks = await taskRepo.listByDate(user.id, date);
  const closureNarrative = [input.commentary, voiceResult.transcript]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join("\n\n");

  const aiFeedback = await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildDayClosureFeedbackPrompt({
      planSnapshot: snapshotJsonToTyped(plan.taskSnapshot),
      currentTaskStates: currentTaskStateFrom(currentTasks),
      closureNarrative,
    }),
    schema: dayClosureFeedbackSchema,
  });

  const persisted = await dayClosureRepo.create({
    userId: user.id,
    date,
    commentary: input.commentary ?? "",
    aiFeedback,
    mediaIds: [],
  });

  return {
    dayClosureId: persisted.id,
    transcript: voiceResult.transcript,
    taskUpdates: voiceResult.actions,
    recommendedNewTasks: voiceResult.recommendations,
    aiFeedback,
  };
}

export function getDayClosure(
  user: AuthenticatedUser,
  query: GetDayClosureQuery,
): Promise<dayClosureRepo.DayClosureSubmission | null> {
  if (query.date === undefined) return Promise.resolve(null);
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
