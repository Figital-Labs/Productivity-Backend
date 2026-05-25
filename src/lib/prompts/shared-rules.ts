/**
 * Sprint 11: shared prompt rule blocks. Currently consumed by the three
 * delegation prompts (team-voice-delegate, team-text-delegate,
 * team-image-delegate). The four personal prompts (voice-intent,
 * text-intent, image-extraction, unified-intent) still have these rules
 * inline — they shipped Sprint 10 and a refactor here would risk drift in
 * the byte-identical guarantees for personal flows. A future cleanup pass
 * can converge them.
 *
 * Each export below is either a string constant (no template values) or a
 * factory function taking the dynamic anchors. Compose by `${A}\n\n${B}`.
 */

/**
 * The TODAY anchor + relative-date resolution rules. Anchors are passed in
 * so the prompt builder can interpolate today's date at request time.
 */
export function dateResolutionRule(today: string, tomorrow: string, yesterday: string): string {
  return `TODAY'S DATE: ${today} (YYYY-MM-DD, IST). Use this to resolve all relative date references:
  - "today" / "aaj"                            → ${today}
  - "tomorrow" / "kal" (future tense)          → ${tomorrow}
  - "yesterday" / "kal" (past tense)           → ${yesterday}
  - "day after tomorrow" / "parso" (future)    → date 2 days from ${today}
  - "day before yesterday" / "parso" (past)    → date 2 days before ${today}
  - "Friday" / "shukrawar" / "next Monday"     → the next occurrence of that weekday after ${today}
  - "next week"                                → date 7 days after ${today}

HINDI "KAL" / "PARSO" DISAMBIGUATION — CRITICAL
Hindi uses the same word for past and future of the same word — the only signal is verbal tense:
  - "kal main report submit karunga"     → FUTURE tense → tomorrow (${tomorrow})
  - "kal main report submit kar di thi"  → PAST tense → yesterday (${yesterday})
  - "kal ka meeting prepare karna hai"   → FUTURE intent → tomorrow
  - "kal patient ko dekha tha"           → PAST tense → yesterday
If tense is ambiguous, route to "recommendations" with a brief reasoning. Don't guess.`;
}

/**
 * The Hinglish output language rule for the user-facing `reasoning` field.
 * Same exact text across modalities — the reasoning is shown verbatim on
 * recommendation cards.
 */
export const HINGLISH_REASONING_RULE = `OUTPUT LANGUAGE FOR reasoning — MIRROR THE USER (USER-FACING)
This reasoning is shown DIRECTLY to the user. Talk to them like their P.A.:

  - LENGTH: 1 short sentence, ≤ 20 words. No preamble. No rule references.
  - LANGUAGE: detect the user's dominant input language and reply in THE SAME language.
      * Pure English input               → English reasoning
      * Hindi / Hinglish / mixed input   → Hinglish reasoning (Roman script, NEVER Devanagari)
      * Unsure                           → default to Hinglish (product's home language)
  - TONE: warm, direct, helpful — like a smart teammate. No academic phrasing.`;

/**
 * The Hinglish output rule for `title` / `notes` fields — never Devanagari,
 * always Roman script even when the input was in Devanagari.
 */
export const HINGLISH_TITLE_NOTES_RULE = `OUTPUT LANGUAGE FOR title / notes
ALL transcribed and quoted text MUST be in Hinglish or English in Roman script. Never use Devanagari, even when the user spoke or wrote in Hindi. Romanize naturally — write it the way an Indian English speaker would type it in WhatsApp.
  ✓ "Patient ke rounds complete kar diye"
  ✓ "Buy milk on the way home"
  ✗ "मरीज़ के राउंड पूरे कर लिए"          (Devanagari — never output)`;

/**
 * The conservative-by-default rule — the most important constraint per
 * ADR-0005. When in doubt, recommend, don't act.
 */
export const CONSERVATIVE_DEFAULT_RULE = `CONSERVATIVE BY DEFAULT
When uncertain, put the item in "recommendations", never "actions". The frontend asks the user to confirm recommendations before any DB write. When in doubt: RECOMMEND, never ACT. This protects the user from AI mistakes.`;

/**
 * Existing-task matching rule for priority_updated / completed / partial /
 * target_date_updated. Use exact id, don't invent.
 */
export const EXISTING_TASK_MATCHING_RULE = `EXISTING-TASK MATCHING — priority_updated / completed / partial / target_date_updated
Match user phrases primarily by task TITLE. Use the exact "id" from the pending-tasks JSON. Do NOT invent or guess ids.
  - If two pending tasks have similar titles, use the optional "notes" field for disambiguation.
  - Notes are CONTEXT for disambiguation only. Do NOT take action on something that's only mentioned in notes.
  - If no pending task plausibly matches, put it in "recommendations" with the inferred state.`;

/**
 * Target-date-update rule for moving an existing task. Sprint 10 shipped
 * this — included here for delegation prompts that need to learn the same
 * primitive.
 */
export const TARGET_DATE_UPDATE_RULE = `TARGET DATE UPDATE — moving an existing task to a different date
When the user clearly references an EXISTING pending task (matched by title) AND clearly specifies a new date (relative or absolute), emit a "target_date_updated" action. Do NOT create a duplicate. Do NOT emit a recommendation.

  ✓ Input: "Sneha se baat karna hai - Monday ko karna hai" + existing task "Sneha se baat karna hai"
    → target_date_updated { taskId: <existing>, targetDate: "<resolved Monday>" }
  ✓ Input: "Friday ko ward 12 visit shift kar do" + existing task "Ward 12 visit"
    → target_date_updated { taskId: <existing>, targetDate: "<upcoming Friday>" }

When NOT to use target_date_updated:
  - User says a date but NO existing task plausibly matches → use "created" with "targetDate".
  - User ambiguously names which task → recommendation (carry resolved "targetDate" on the recommendation).
  - User explicitly asks for a duplicate ("create a new one for Monday too") → use "created".`;

/**
 * Priority cues — allowed values + Hindi/English keyword triggers for HIGH.
 */
export const PRIORITY_CUES_RULE = `PRIORITY
Allowed values: "low", "medium", "high". Omit if the user didn't indicate priority.
Cues for HIGH: "urgent", "ASAP", "जल्दी", "abhi karna hai", "important", expletives, triple-or-more "!!!".`;

/**
 * Recommendation title format — clean noun-phrase, not a question. Optional
 * targetDate field is honored by the frontend's ADD handler.
 */
export const RECOMMENDATION_TITLE_FORMAT_RULE = `RECOMMENDATION TITLE FORMAT — and optional "targetDate"
The "title" field on a recommendation is what the task will be CALLED when the user taps ADD. It MUST be a clean, declarative task name — NOT a question, NOT a "Shift X to Y?" prompt, NOT a sentence with quoted strings inside it.

  ✓ "Sneha se baat karna hai"
  ✓ "Submit quarterly report"
  ✓ "Ward 12 round (Monday)"
  ✗ "Shift 'Sneha se baat karna hai' (today's task) to tomorrow?"
  ✗ "Did you mean to create a new task for X?"
  ✗ "Add task: Sneha se baat karna hai"

The question/explanation belongs in "reasoning". The "title" is the title.

When the recommendation implies a specific date (user said "Monday" but match is ambiguous, ad-hoc work with a date phrase), include the resolved date as "targetDate": "YYYY-MM-DD". The frontend uses this so ADD lands the task on that date instead of the user's current viewDate.`;
