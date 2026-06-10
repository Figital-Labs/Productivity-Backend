/**
 * Golden-set eval cases for the AI extraction prompts. Text/image-free surfaces
 * only (no media fixtures needed) so this runs from a dev machine with Vertex
 * creds via `npm run eval`. Assert on STRUCTURE/fields, never free-text.
 *
 * Each case builds the exact prompt the service builds and calls Gemini at the
 * same temperature as production. Add real failures here as they surface in the
 * `[ai-raw]` logs.
 */
import "dotenv/config";

import { AI_TEMPERATURE, AI_THINKING_BUDGET } from "../src/lib/ai-config.js";
import { buildDayClosureFeedbackPrompt } from "../src/lib/prompts/day-closure-feedback.js";
import { buildTeamTextDelegatePrompt } from "../src/lib/prompts/team-text-delegate.js";
import { buildTextIntentPrompt } from "../src/lib/prompts/text-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../src/lib/vertex.js";
import { dayClosureFeedbackSchema } from "../src/schemas/day-closure-feedback.schema.js";
import { teamTextDelegateResponseSchema } from "../src/schemas/team-text-delegate.schema.js";
import { textIntentResponseSchema } from "../src/schemas/text-process.schema.js";
import { promptDateAnchors, todayInUserTz } from "../src/utils/date.js";

const anchors = promptDateAnchors(todayInUserTz("Asia/Kolkata"));
const DEVANAGARI = /[ऀ-ॿ]/;

interface EvalAction {
  type?: string;
  title?: string;
  assigneeId?: string;
  taskId?: string;
  targetDate?: string;
  priority?: string;
}
interface EvalResponse {
  actions?: EvalAction[];
  recommendations?: { title?: string; reasoning?: string }[];
  taskActions?: { taskId: string; status: string }[];
  achievements?: string[];
  summary?: string;
}

export interface EvalCase {
  id: string;
  run: () => Promise<EvalResponse>;
  /** Return null to pass, or a failure detail string. */
  assert: (r: EvalResponse) => string | null;
}

function noDevanagari(r: EvalResponse): string | null {
  for (const a of r.actions ?? []) {
    if (a.title && DEVANAGARI.test(a.title)) return `Devanagari in action title: ${a.title}`;
  }
  for (const rec of r.recommendations ?? []) {
    if (rec.title && DEVANAGARI.test(rec.title)) return `Devanagari in rec title: ${rec.title}`;
  }
  return null;
}

const pendingRounds = [
  { id: "task-rounds", title: "Patient rounds", priority: "medium", targetDate: anchors.today },
];

const directory = [{ id: "u-sneha", name: "Sneha", role: "Nurse" }];

async function text(
  userText: string,
  pendingTasks: typeof pendingRounds | [],
): Promise<EvalResponse> {
  return (await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildTextIntentPrompt({ pendingTasks, userText, ...anchors }),
    schema: textIntentResponseSchema,
    temperature: AI_TEMPERATURE.extraction,
    thinkingBudget: AI_THINKING_BUDGET.extraction,
  })) as unknown as EvalResponse;
}

async function delegate(userText: string): Promise<EvalResponse> {
  return (await generateStructured({
    model: GEMINI_FLASH_MODEL,
    prompt: buildTeamTextDelegatePrompt({ directory, selfUserId: "u-self", userText, ...anchors }),
    schema: teamTextDelegateResponseSchema,
    temperature: AI_TEMPERATURE.delegation,
    thinkingBudget: AI_THINKING_BUDGET.delegation,
  })) as unknown as EvalResponse;
}

export const cases: EvalCase[] = [
  {
    id: "text/new-task-date-priority",
    run: () => text("Kal ICU mein Dr. Mehta ke liye OT prep karna hai, urgent", []),
    assert: (r) => {
      const dev = noDevanagari(r);
      if (dev) return dev;
      const created = (r.actions ?? []).find((a) => a.type === "created");
      if (!created) return "expected a created action";
      // Title must preserve the work (OT) and the person (Dr. Mehta); exact
      // phrasing is the model's call ("Prepare OT for Dr. Mehta" is fine).
      if (!/\bOT\b/i.test(created.title ?? "")) return `title missing 'OT': ${created.title ?? ""}`;
      if (!/mehta/i.test(created.title ?? ""))
        return `title missing 'Dr. Mehta': ${created.title ?? ""}`;
      if (created.priority !== "high")
        return `expected priority high, got ${created.priority ?? "none"}`;
      if (created.targetDate !== anchors.tomorrow)
        return `expected targetDate ${anchors.tomorrow}, got ${created.targetDate ?? "none"}`;
      return null;
    },
  },
  {
    id: "text/ad-hoc-completed-recommendation",
    // Already-done work not on the pending list → recommendation (completed),
    // NOT a silent create-and-complete. Exercises AD_HOC_RULE.
    run: () => text("Aaj maine extra emergency triage bhi kiya", []),
    assert: (r) => {
      const dev = noDevanagari(r);
      if (dev) return dev;
      if ((r.recommendations ?? []).length < 1)
        return "expected a recommendation for ad-hoc already-done work (AD_HOC_RULE)";
      return null;
    },
  },
  {
    id: "text/partial-existing-rounds",
    run: () => text("Aaj rounds adha hua", pendingRounds),
    assert: (r) => {
      const partial = (r.actions ?? []).find((a) => a.type === "partial");
      if (!partial) return "expected a 'partial' action on the existing task, not a new task";
      if (partial.taskId !== "task-rounds")
        return `expected taskId task-rounds, got ${partial.taskId ?? "none"}`;
      return null;
    },
  },
  {
    id: "text/future-tense-date",
    run: () => text("Kal Dr. Sharma ko report bhejni hai", []),
    assert: (r) => {
      const created = (r.actions ?? []).find((a) => a.type === "created");
      if (!created) return "expected a created action";
      if (created.targetDate !== anchors.tomorrow)
        return `future-tense 'kal' should resolve to ${anchors.tomorrow}, got ${created.targetDate ?? "none"}`;
      return null;
    },
  },
  {
    id: "delegation/known-name",
    run: () => delegate("Sneha ko bolo ICU rounds le le sham tak"),
    assert: (r) => {
      const a = (r.actions ?? [])[0];
      if (!a) return "expected a delegation action";
      if (a.assigneeId !== "u-sneha")
        return `expected assigneeId u-sneha, got ${a.assigneeId ?? "none"}`;
      if (!/ICU rounds/i.test(a.title ?? "")) return `title missing 'ICU rounds': ${a.title ?? ""}`;
      return null;
    },
  },
  {
    id: "delegation/unknown-name",
    run: () => delegate("Rajesh ko bolo X karna hai"),
    assert: (r) => {
      if ((r.actions ?? []).some((a) => a.assigneeId && a.assigneeId !== "u-self"))
        return "must not assign to a person who isn't in the directory";
      if ((r.recommendations ?? []).length < 1)
        return "expected a recommendation (Rajesh not in the team directory)";
      return null;
    },
  },
  {
    id: "day-closure/sab-ho-gaya",
    run: async () =>
      (await generateStructured({
        model: GEMINI_FLASH_MODEL,
        prompt: buildDayClosureFeedbackPrompt({
          todaysTasks: [
            {
              id: "t1",
              title: "Ward 12 rounds",
              completed: false,
              isPartial: false,
              priority: "medium",
            },
            {
              id: "t2",
              title: "Submit report",
              completed: false,
              isPartial: false,
              priority: "high",
            },
            { id: "t3", title: "Call vendor", completed: false, isPartial: false, priority: "low" },
          ],
          hasDayPlan: true,
          closureNarrative: "Sab ho gaya aaj, list clear kar di",
        }),
        schema: dayClosureFeedbackSchema,
        temperature: AI_TEMPERATURE.dayClosure,
        thinkingBudget: AI_THINKING_BUDGET.dayClosure,
      })) as unknown as EvalResponse,
    assert: (r) => {
      const done = new Set(
        (r.taskActions ?? []).filter((a) => a.status === "completed").map((a) => a.taskId),
      );
      if (!(done.has("t1") && done.has("t2") && done.has("t3")))
        return `expected all 3 tasks completed via taskActions, got [${[...done].join(", ")}]`;
      return null;
    },
  },
];
