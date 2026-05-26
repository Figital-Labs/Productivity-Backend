import { z } from "zod";

import { dateStringSchema, priorityEnum } from "./common.js";

export const listActivityQuerySchema = z
  .object({
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
    scope: z.enum(["personal", "team", "org"]).optional(),
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: "`from` must be on or before `to`",
    path: ["from"],
  });
export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

export const activityActionTypeSchema = z.enum([
  "created",
  "completed",
  "partial",
  "priority_updated",
  // Sprint 10 — date-shift action. Surfaces inside ai_*_batch events when the
  // AI emitted a `target_date_updated` action for an existing task.
  "target_date_updated",
]);
export type ActivityActionType = z.infer<typeof activityActionTypeSchema>;

export const actionCountsSchema = z.object({
  created: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  priority_updated: z.number().int().nonnegative(),
  target_date_updated: z.number().int().nonnegative(),
});
export type ActionCounts = z.infer<typeof actionCountsSchema>;

export const affectedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  action: activityActionTypeSchema,
});
export type AffectedTask = z.infer<typeof affectedTaskSchema>;

const aiBatchBaseSchema = z.object({
  at: z.string(),
  interactionId: z.string(),
  summary: actionCountsSchema,
  affectedTasks: z.array(affectedTaskSchema),
});

// Sprint 11: delegation enrichment. When a task's creator and assignee differ,
// these fields surface who delegated it and to whom — frontend renders
// "Dr. Sharma assigned this to you" or "You assigned this to Sneha" depending
// on whose feed it is.
const delegationParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const taskCreatedManualEventSchema = z.object({
  type: z.literal("task_created_manual"),
  at: z.string(),
  task: z.object({
    id: z.string(),
    title: z.string(),
    priority: priorityEnum.nullable(),
  }),
  delegatedBy: delegationParticipantSchema.optional(),
  delegatedTo: delegationParticipantSchema.optional(),
});

const taskCompletedEventSchema = z.object({
  type: z.literal("task_completed"),
  at: z.string(),
  task: z.object({
    id: z.string(),
    title: z.string(),
  }),
  delegatedBy: delegationParticipantSchema.optional(),
  delegatedTo: delegationParticipantSchema.optional(),
});

const dayPlanSubmittedEventSchema = z.object({
  type: z.literal("day_plan_submitted"),
  at: z.string(),
  submissionId: z.string(),
  date: dateStringSchema,
  taskCount: z.number().int().nonnegative(),
});

const dayClosureSubmittedEventSchema = z.object({
  type: z.literal("day_closure_submitted"),
  at: z.string(),
  submissionId: z.string(),
  date: dateStringSchema,
  hasAiFeedback: z.boolean(),
});

// Sprint 15: meeting_processed event. Surfaces when a meeting's AI processing
// finishes. Carries attendee chips, the AI summary, per-action assignees, and
// recommendation titles inline so the History card can expand without a second
// fetch — same density as `ai_voice_batch` projection (transcript +
// affectedTasks).
const meetingAttendeeRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const meetingProcessedActionItemSchema = z.object({
  title: z.string(),
  assigneeId: z.string(),
  assigneeName: z.string(),
});

const meetingProcessedRecommendationSchema = z.object({
  title: z.string(),
});

const meetingProcessedEventSchema = z.object({
  type: z.literal("meeting_processed"),
  at: z.string(),
  meetingId: z.string(),
  title: z.string(),
  actionItemCount: z.number().int().nonnegative(),
  recommendationCount: z.number().int().nonnegative(),
  attendees: z.array(meetingAttendeeRefSchema),
  summary: z.string(),
  actionItems: z.array(meetingProcessedActionItemSchema),
  recommendations: z.array(meetingProcessedRecommendationSchema),
});

export const activityEventSchema = z.discriminatedUnion("type", [
  aiBatchBaseSchema.extend({
    type: z.literal("ai_voice_batch"),
    transcript: z.string().optional(),
  }),
  aiBatchBaseSchema.extend({
    type: z.literal("ai_text_batch"),
    inputText: z.string().optional(),
  }),
  aiBatchBaseSchema.extend({
    type: z.literal("ai_image_batch"),
    extractedText: z.string().optional(),
  }),
  aiBatchBaseSchema.extend({
    type: z.literal("ai_unified_batch"),
  }),
  taskCreatedManualEventSchema,
  taskCompletedEventSchema,
  dayPlanSubmittedEventSchema,
  dayClosureSubmittedEventSchema,
  meetingProcessedEventSchema,
]);
export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const activityResponseSchema = z.array(activityEventSchema);
export type ActivityResponse = z.infer<typeof activityResponseSchema>;
