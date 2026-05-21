import { z } from "zod";

export const createNoteInputSchema = z.object({
  content: z.string().trim().min(1).max(10000),
});
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z
  .object({
    content: z.string().trim().min(1).max(10000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;
