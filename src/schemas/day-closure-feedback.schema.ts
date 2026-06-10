import { z } from "zod";

/**
 * The structured AI feedback shape for `POST /day-closure/review` (Sprint 17).
 * Persisted as JSON into `DayClosureSubmission.aiFeedback`. Enforced at decode
 * time via Vertex's `responseJsonSchema` AND re-validated on receipt (per the
 * same UpstreamError contract used by voice + image flows).
 *
 * Output language is Hinglish/English Roman script everywhere — the prompt
 * carries the rule.
 */
export const dayClosureFeedbackSchema = z.object({
  achievements: z.array(z.string()).describe("Tasks the user completed today"),
  missed: z.array(z.string()).describe("Tasks that weren't done and weren't mentioned"),
  partial: z.array(z.string()).describe("Tasks partially done"),
  additions: z.array(z.string()).describe("Ad-hoc work mentioned in narrative not in task list"),
  summary: z.string().describe("Brief 1-2 sentence overall wrap-up"),
  taskActions: z
    .array(
      z.object({
        taskId: z.string(),
        status: z.enum(["completed", "partial"]),
      }),
    )
    .describe("Tasks to auto-update based on what the user said in their narrative"),
});
export type DayClosureFeedback = z.infer<typeof dayClosureFeedbackSchema>;
