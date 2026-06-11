/**
 * Golden-set eval cases for the AI extraction prompts. Text/image-free surfaces
 * only (no media fixtures needed) so this runs from a dev machine with Vertex
 * creds via `npm run eval`. Assert on STRUCTURE/fields, never free-text.
 *
 * ⚠️ HELD-OUT INPUTS RULE: the inputs below MUST NOT appear as worked examples in
 * any prompt (shared-rules constants, meeting-intent, etc.). Reusing a prompt's own
 * example tests memorization, not generalization, and inflates the pass rate. So we
 * deliberately use novel names / tasks / phrasings (no Sneha/Anita/Vikram/Rajesh/
 * Subh Sir/Dr. Mehta/OT prep/ward rounds/gloves/admissions/emergency-triage) while
 * exercising the same behaviors the prompts define.
 */
import "dotenv/config";

import { AI_TEMPERATURE, AI_THINKING_BUDGET } from "../src/lib/ai-config.js";
import { buildDayClosureFeedbackPrompt } from "../src/lib/prompts/day-closure-feedback.js";
import { buildMeetingIntentPrompt } from "../src/lib/prompts/meeting-intent.js";
import { buildTeamTextDelegatePrompt } from "../src/lib/prompts/team-text-delegate.js";
import { buildTextIntentPrompt } from "../src/lib/prompts/text-intent.js";
import { GEMINI_FLASH_MODEL, generateStructured } from "../src/lib/vertex.js";
import { dayClosureFeedbackSchema } from "../src/schemas/day-closure-feedback.schema.js";
import { meetingIntentResponseSchema } from "../src/schemas/meeting.schema.js";
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

// Held-out fixtures — names/tasks NOT used in any prompt example.
const pendingPharmacy = [
  { id: "t-pharm", title: "Pharmacy stock count", priority: "medium", targetDate: anchors.today },
];
const directory = [{ id: "u-kavita", name: "Kavita", role: "Technician" }];

async function text(
  userText: string,
  pendingTasks: typeof pendingPharmacy | [],
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
    // new task + future date + priority cue (held-out: Bed 7 / discharge summary)
    id: "text/new-task-date-priority",
    run: () => text("Kal Bed 7 ke patient ka discharge summary banana hai, urgent", []),
    assert: (r) => {
      const dev = noDevanagari(r);
      if (dev) return dev;
      const created = (r.actions ?? []).find((a) => a.type === "created");
      if (!created) return "expected a created action";
      if (!/discharge summary/i.test(created.title ?? ""))
        return `title missing 'discharge summary': ${created.title ?? ""}`;
      if (!/bed 7/i.test(created.title ?? ""))
        return `title dropped the identifier 'Bed 7': ${created.title ?? ""}`;
      if (created.priority !== "high")
        return `expected priority high, got ${created.priority ?? "none"}`;
      if (created.targetDate !== anchors.tomorrow)
        return `expected targetDate ${anchors.tomorrow}, got ${created.targetDate ?? "none"}`;
      return null;
    },
  },
  {
    // ad-hoc work already DONE, not on the list → recommendation (AD_HOC_RULE),
    // held-out: canteen stock check
    id: "text/ad-hoc-completed-recommendation",
    run: () => text("Aaj maine canteen ka stock bhi check kar liya", []),
    assert: (r) => {
      const dev = noDevanagari(r);
      if (dev) return dev;
      if ((r.recommendations ?? []).length < 1)
        return "expected a recommendation for ad-hoc already-done work (AD_HOC_RULE)";
      return null;
    },
  },
  {
    // partial of an existing task (held-out: pharmacy stock count)
    id: "text/partial-existing",
    run: () => text("Pharmacy stock count abhi aadha hua hai", pendingPharmacy),
    assert: (r) => {
      const partial = (r.actions ?? []).find((a) => a.type === "partial");
      if (!partial) return "expected a 'partial' action on the existing task, not a new task";
      if (partial.taskId !== "t-pharm")
        return `expected taskId t-pharm, got ${partial.taskId ?? "none"}`;
      return null;
    },
  },
  {
    // future-tense 'kal' → tomorrow (held-out: Dr. Nair / lab results)
    id: "text/future-tense-date",
    run: () => text("Kal Dr. Nair ke saath lab results discuss karne hain", []),
    assert: (r) => {
      const created = (r.actions ?? []).find((a) => a.type === "created");
      if (!created) return "expected a created action";
      if (created.targetDate !== anchors.tomorrow)
        return `future-tense 'kal' should resolve to ${anchors.tomorrow}, got ${created.targetDate ?? "none"}`;
      return null;
    },
  },
  {
    // past-tense 'kal ... kar liya tha' → must NOT create a tomorrow task
    // (held-out: pharmacy audit)
    id: "text/kal-past-not-future",
    run: () => text("kal maine pharmacy ka audit kar liya tha", pendingPharmacy),
    assert: (r) => {
      const futureCreate = (r.actions ?? []).find(
        (a) => a.type === "created" && a.targetDate === anchors.tomorrow,
      );
      if (futureCreate) return "past-tense 'kal ... kar liya tha' wrongly created a tomorrow task";
      return null;
    },
  },
  {
    // multi-item chunking (held-out: blood samples / Dr. Iyer / oxygen cylinders)
    id: "text/multi-task-chunking",
    run: () =>
      text(
        "Pehle blood samples collect karne hain, phir Dr. Iyer ko discharge update dena hai, aur shaam ko oxygen cylinders ka count karna hai",
        [],
      ),
    assert: (r) => {
      const dev = noDevanagari(r);
      if (dev) return dev;
      const created = (r.actions ?? []).filter((a) => a.type === "created");
      if (created.length < 3) return `expected >=3 created tasks, got ${created.length.toString()}`;
      return null;
    },
  },
  {
    // honorific + name preserved — RULE generalization, NOT the "Subh Sir" example
    // (held-out: Farhan bhai / duty roster)
    id: "text/honorific-preserved",
    run: () => text("Farhan bhai ko duty roster bhejna hai", []),
    assert: (r) => {
      const c = (r.actions ?? []).find((a) => a.type === "created");
      if (!c) return "expected a created action";
      if (!/farhan/i.test(c.title ?? "")) return `dropped the name 'Farhan': ${c.title ?? ""}`;
      if (!/duty roster/i.test(c.title ?? "")) return `dropped 'duty roster': ${c.title ?? ""}`;
      return null;
    },
  },
  {
    // delegation to a known team member (held-out: Kavita / X-ray calibration)
    id: "delegation/known-name",
    run: () => delegate("Kavita ko bol do X-ray machine ka calibration kar le"),
    assert: (r) => {
      const a = (r.actions ?? [])[0];
      if (!a) return "expected a delegation action";
      if (a.assigneeId !== "u-kavita")
        return `expected assigneeId u-kavita, got ${a.assigneeId ?? "none"}`;
      if (!/calibration/i.test(a.title ?? ""))
        return `title missing 'calibration': ${a.title ?? ""}`;
      return null;
    },
  },
  {
    // delegation to a name NOT in the directory → recommendation (held-out: Imran)
    id: "delegation/unknown-name",
    run: () => delegate("Imran ko bolo bed allocation update karna hai"),
    assert: (r) => {
      if ((r.actions ?? []).some((a) => a.assigneeId && a.assigneeId !== "u-self"))
        return "must not assign to a person who isn't in the directory";
      if ((r.recommendations ?? []).length < 1)
        return "expected a recommendation (Imran not in the team directory)";
      return null;
    },
  },
  {
    // "everything done" understanding with novel phrasing (NOT "sab ho gaya / list clear")
    id: "day-closure/all-done-novel-phrasing",
    run: async () =>
      (await generateStructured({
        model: GEMINI_FLASH_MODEL,
        prompt: buildDayClosureFeedbackPrompt({
          todaysTasks: [
            {
              id: "t1",
              title: "Morning OPD slips",
              completed: false,
              isPartial: false,
              priority: "medium",
            },
            {
              id: "t2",
              title: "Restock crash cart",
              completed: false,
              isPartial: false,
              priority: "high",
            },
            {
              id: "t3",
              title: "Email lab vendor",
              completed: false,
              isPartial: false,
              priority: "low",
            },
          ],
          hasDayPlan: true,
          closureNarrative: "aaj sab nipta diya, kuch bhi pending nahi raha",
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
  {
    // meeting: don't miss the two items; one has an owner, one is owner-TBD
    // (held-out: Ravi / sterilise OT instruments / broken AC in Room 204)
    id: "meeting/owner-and-unassigned",
    run: async () =>
      (await generateStructured({
        model: GEMINI_FLASH_MODEL,
        prompt: buildMeetingIntentPrompt({
          attendees: [{ id: "u-ravi", name: "Ravi", role: "OT Technician" }],
          selfUserId: "u-self",
          title: "OT morning huddle",
          agenda: null,
          notes:
            "Ravi will sterilise the OT instruments before the 8am list. Also the AC in Room 204 is broken and must be fixed — owner not decided yet.",
          customPrompt: undefined,
          ...anchors,
        }),
        schema: meetingIntentResponseSchema,
        temperature: AI_TEMPERATURE.meeting,
        thinkingBudget: AI_THINKING_BUDGET.meeting,
      })) as unknown as EvalResponse,
    assert: (r) => {
      if (!(r.summary && r.summary.length > 0)) return "expected a non-empty summary";
      const all = [...(r.actions ?? []), ...(r.recommendations ?? [])];
      if (!all.some((x) => /steril|instrument/i.test(x.title ?? "")))
        return "missed the sterilise-instruments task";
      if (!all.some((x) => /\bAC\b|204/i.test(x.title ?? ""))) return "missed the AC repair item";
      return null;
    },
  },
];
