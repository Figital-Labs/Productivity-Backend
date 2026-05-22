/**
 * Builds the prompt for the SECOND Vertex call in `/day-closure/submit`.
 * The first call (voice-intent) already executed any task updates the user
 * spoke about. This call generates the structured `aiFeedback` comparing
 * morning plan vs end-of-day reality.
 *
 * The model returns structured JSON; shape enforced via `responseJsonSchema`
 * (see src/lib/vertex.ts). The prompt's job is to convey semantics.
 */

import type { TaskSnapshotEntry } from "../../schemas/day-plan.schema.js";

export interface CurrentTaskState {
  id: string;
  title: string;
  completed: boolean;
  isPartial: boolean;
  priority: string | null;
}

export interface BuildDayClosureFeedbackPromptArgs {
  planSnapshot: TaskSnapshotEntry[];
  currentTaskStates: CurrentTaskState[];
  closureNarrative: string;
}

export function buildDayClosureFeedbackPrompt(args: BuildDayClosureFeedbackPromptArgs): string {
  const planJson = JSON.stringify(args.planSnapshot, null, 2);
  const currentJson = JSON.stringify(args.currentTaskStates, null, 2);

  return `ROLE
You are an end-of-day reflection assistant for a multilingual Indian user (typically hospital staff). The user has finished their day and submitted commentary about what they did. Compare the morning's planned tasks against today's actual outcomes and generate concise structured feedback.

INPUT
1. MORNING PLAN — tasks the user committed to at the start of the day
2. CURRENT TASK STATES — same tasks at end of day, showing completion status (any voice-driven updates from the closure submission have already been applied here)
3. CLOSURE NARRATIVE — the user's typed and/or spoken reflection about today

OUTPUT LANGUAGE — IMPORTANT
ALL output text MUST be in Hinglish or English in Roman script. Do NOT use Devanagari or any other non-Latin script, even if the narrative contains Devanagari input.
  ✓ "Report ka draft complete kar liya"
  ✓ "Finished patient rounds on time"
  ✗ "रिपोर्ट का ड्राफ्ट कम्प्लीट कर लिया"     (Devanagari — never output)

OUTPUT FIELDS:
- achievements   — string[] of planned tasks the user completed today (use the task title as the string, in Hinglish)
- missed         — string[] of planned tasks NOT completed and NOT partial
- partial        — string[] of planned tasks the user started but didn't fully finish
- additions      — string[] of work the user mentioned doing today that wasn't in the morning plan
- tips           — string[] of 0-3 actionable suggestions for tomorrow (Hinglish, supportive tone, brief)
- summary        — string, 1-2 sentence overall wrap-up of the day (Hinglish, encouraging but honest)

RULES (in priority order):

1. SOURCE OF TRUTH FOR completed/missed/partial
   Use the CURRENT TASK STATES below for the completion status of each planned task — NOT what the user said in the narrative. The narrative may understate (user forgot to mention finishing something) or overstate ("I did everything!" when they didn't). The current task state is what actually happened in the system.

2. ACHIEVEMENTS = planned ∧ completed
   Only include tasks that were BOTH in the morning plan AND are now completed=true.

3. MISSED = planned ∧ NOT completed ∧ NOT partial
   Tasks from the morning plan that are still incomplete and weren't started.

4. PARTIAL = planned ∧ NOT completed ∧ isPartial=true
   Tasks the user started but didn't finish.

5. ADDITIONS come from the NARRATIVE, not the task state
   Look at what the user mentioned doing that wasn't on the morning plan. These weren't auto-created (per ADR-0005, recommendation pattern). Surface them as plain titles in "additions" — the user can choose to add them via the frontend later if relevant.

6. TIPS should be SPECIFIC, not generic
   Bad:  "Try to finish all your tasks tomorrow"
   Good: "Mornings se admin work block kar lo — pichle 3 din se admin tasks slip ho rahe hain"
   If you don't have enough signal for a meaningful tip, leave the array empty rather than padding.

7. SUMMARY is 1-2 sentences MAX
   Honest about misses, supportive in tone. Don't be preachy. Don't be robotic. Hinglish welcome.

8. EMPTY-PLAN EDGE CASE
   If the morning plan was empty (no tasks committed to), achievements/missed/partial are all empty arrays. Additions come from the narrative. Tips and summary still apply.

MORNING PLAN:
${planJson}

CURRENT TASK STATES (end of day, after any voice updates):
${currentJson}

CLOSURE NARRATIVE:
${args.closureNarrative.trim() ? args.closureNarrative : "(no narrative provided)"}
`;
}
