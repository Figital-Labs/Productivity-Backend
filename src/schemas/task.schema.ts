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
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export const listTasksQuerySchema = z.object({
  date: dateStringSchema.optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
