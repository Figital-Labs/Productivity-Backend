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
  achievements: z.array(z.string()).describe("Completed tasks from the morning plan"),
  missed: z
    .array(z.string())
    .describe("Planned tasks that weren't completed (and weren't partial either)"),
  partial: z.array(z.string()).describe("Tasks the user started but didn't fully finish"),
  additions: z.array(z.string()).describe("Ad-hoc work the user did today that wasn't on the plan"),
  tips: z.array(z.string()).min(0).max(3).describe("1-3 actionable suggestions for tomorrow"),
  summary: z.string().describe("Brief 1-2 sentence overall wrap-up"),
});
export type DayClosureFeedback = z.infer<typeof dayClosureFeedbackSchema>;
