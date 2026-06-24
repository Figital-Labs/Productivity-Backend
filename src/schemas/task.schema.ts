import { z } from "zod";

import { dateStringSchema, priorityEnum } from "./common.js";

export const createTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  targetDate: dateStringSchema.optional(),
  notes: z.string().max(5000).optional(),
  priority: priorityEnum.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    notes: z.string().max(5000).nullable().optional(),
    priority: priorityEnum.nullable().optional(),
    completed: z.boolean().optional(),
    isPartial: z.boolean().optional(),
    targetDate: dateStringSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

// Sprint 19: time-slot scheduling. `startMinute` is minutes from local midnight
// (null unschedules → Unscheduled bucket); `durationMinutes` defaults server-side
// to the task's current duration or 30. Cascade is applied in the service.
export const scheduleTaskInputSchema = z.object({
  startMinute: z.number().int().min(0).max(1439).nullable(),
  durationMinutes: z.number().int().min(15).max(1440).optional(),
});
export type ScheduleTaskInput = z.infer<typeof scheduleTaskInputSchema>;

export const listTasksQuerySchema = z
  .object({
    date: dateStringSchema.optional(),
    openCarryOver: z.coerce.boolean().optional(),
    // Optional pagination. A single user × single day is naturally bounded, so
    // these are unset by default (full day returned, unchanged behavior). They
    // exist so a pathological day can be paged rather than truncated silently.
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => !(v.date && v.openCarryOver), {
    message: "date and openCarryOver are mutually exclusive",
  });
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
