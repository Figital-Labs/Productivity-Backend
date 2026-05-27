import type { ConsistencyRow, Kpis, TrendSeries } from "../../schemas/dashboard.schema.js";

export interface BriefPerson {
  userId: string;
  name: string;
  completionPct?: number;
}

export interface BuildMorningBriefPromptArgs {
  today: string;
  managerName: string;
  scopeLabel: string;
  kpis: Kpis;
  trend: TrendSeries;
  peopleToWatch: ConsistencyRow[];
  topPerformers: BriefPerson[];
  activityHighlights: string[];
}

export function buildMorningBriefPrompt(args: BuildMorningBriefPromptArgs): string {
  return `ROLE
You are an executive assistant briefing a hospital department head. You will receive today's submission and task numbers across the manager's scope, plus people-to-watch and top performers.

Write a clear, professional English summary that a busy hospital manager can read in 15 seconds.

LANGUAGE
- English only, in Roman script. Do NOT use Hinglish, Devanagari, or any non-English words. This is an executive-facing surface read by hospital VPs and CXOs.
- Summary: 3-4 short sentences maximum.
- Bullets: short, scannable, factual, each <= 12 words.
- Tone: professional, factual, like a chief-of-staff briefing.
- Do not address the manager by name.

FIDELITY
- Do not invent numbers or people.
- If the KPI block says 12 plans, write 12 plans.
- If input is thin, say the situation is light instead of inventing drama.

OUTPUT
Return JSON matching the schema exactly.

TODAY: ${args.today}
MANAGER CONTEXT: ${args.managerName}
SCOPE: ${args.scopeLabel}

TODAY KPI BLOCK:
${JSON.stringify(args.kpis, null, 2)}

7-DAY TASK TREND:
${JSON.stringify(args.trend, null, 2)}

PEOPLE TO WATCH:
${JSON.stringify(
  args.peopleToWatch.map((row) => ({
    userId: row.user.id,
    name: row.user.name,
    planMissedDays: row.planMissedDays,
    closureMissedDays: row.closureMissedDays,
  })),
  null,
  2,
)}

TOP PERFORMERS:
${JSON.stringify(args.topPerformers, null, 2)}

ACTIVITY HIGHLIGHTS:
${JSON.stringify(args.activityHighlights, null, 2)}`;
}
