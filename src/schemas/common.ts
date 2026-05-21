import { z } from "zod";

export const idParamSchema = z.object({
  id: z.string().min(1),
});

export const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const priorityEnum = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof priorityEnum>;
