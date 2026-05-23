import { z } from "zod";

import { dateStringSchema, priorityEnum } from "./common.js";

export const listActivityQuerySchema = z
  .object({
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
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
]);
export type ActivityActionType = z.infer<typeof activityActionTypeSchema>;

export const actionCountsSchema = z.object({
  created: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  priority_updated: z.number().int().nonnegative(),
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

const taskCreatedManualEventSchema = z.object({
  type: z.literal("task_created_manual"),
  at: z.string(),
  task: z.object({
    id: z.string(),
    title: z.string(),
    priority: priorityEnum.nullable(),
  }),
});

const taskCompletedEventSchema = z.object({
  type: z.literal("task_completed"),
  at: z.string(),
  task: z.object({
    id: z.string(),
    title: z.string(),
  }),
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
]);
export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const activityResponseSchema = z.array(activityEventSchema);
export type ActivityResponse = z.infer<typeof activityResponseSchema>;
