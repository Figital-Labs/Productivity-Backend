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
 *
 * Sprint 11 follow-up (prompt-craft pass): adds FIDELITY_PRINCIPLE,
 * TITLE_RULE, NOTES_RULE, DELEGATION_RELAY_EXAMPLES — see plan file
 * `hey-calude-i-was-jiggly-torvalds.md` for the rewrite rationale.
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
 * Recommendation title format — must follow the same clear-intent rule as
 * actions (see TITLE_RULE). The difference between an action and a
 * recommendation is the AI's confidence level, not the title's grammar.
 */
export const RECOMMENDATION_TITLE_FORMAT_RULE = `RECOMMENDATION TITLE FORMAT — and optional "targetDate"
A recommendation's "title" follows the same shape as an action's title (see TITLE rule): it must carry the full clear intent of the task — not a question, not a "Shift X to Y?" prompt, not a sentence with quoted strings inside it.

  ✓ "Sneha se baat karna hai"
  ✓ "Submit quarterly report"
  ✓ "Ward 12 round (Monday)"
  ✗ "Shift 'Sneha se baat karna hai' (today's task) to tomorrow?"
  ✗ "Did you mean to create a new task for X?"
  ✗ "Add task: Sneha se baat karna hai"

The question or clarification belongs in "reasoning". The "title" is the title.

When the recommendation implies a specific date (user said "Monday" but match is ambiguous, ad-hoc work with a date phrase), include the resolved date as "targetDate": "YYYY-MM-DD". The frontend uses this so ADD lands the task on that date instead of the user's current viewDate.`;

/**
 * Sprint 11 follow-up — top-priority principle for delegation flows. The
 * manager is dictating an instruction; the AI is a conduit relaying it on
 * the manager's behalf, not a summarizer distilling it. Conduits preserve;
 * summarizers strip. This principle goes near the top of each delegation
 * prompt, before the rules block, so it primes Gemini on every request.
 */
export const FIDELITY_PRINCIPLE = `FIDELITY (top priority)
You are relaying the manager's instruction passively on their behalf, turning it into a task the named assignee can act on. Preserve the manager's clear intent — the work being asked, who it's for, when it's due, why it matters. The assignee, reading this task later, should know exactly what the manager wanted without needing to ask. If you must choose between making the title shorter and preserving the manager's clear intent, choose intent.`;

/**
 * Sprint 11 follow-up — title rule replacing the old "concise (max ~80
 * chars, declarative noun phrase)" rule. The hard char cap is gone; the
 * schema's `max(200)` does the hard limit. Length is calibrated by the
 * worked examples below, not by a number.
 */
export const TITLE_RULE = `TITLE (mandatory)
The title carries the full clear intent of the task — what the assignee needs to do, including the key context the manager said. The assignee opens their task list later and reads only the title; it must let them act without going back to the manager.

  ✓ "Subh bhaiya ko project update dena hai"   (preserves the recipient context)
  ✓ "Ward 12 visit karna hai"                  (simple case, terse OK)
  ✓ "Report submit karne hain kal tak"         (preserves the deadline phrasing)
  ✓ "Sham ko ward rounds karne hain"           (preserves the time-of-day)
  ✗ "Project update dena"                      (vague — for whom? when? why?)
  ✗ "Update"                                   (too thin to act on)
  ✗ "Shift X to Y?"                            (question, not a task)
  ✗ "Add task: Sneha se baat karna hai"        (meta-phrasing, not the task)

Keep titles concise and to the point. Don't reduce to a vague noun-phrase that loses what the manager wants to happen. Don't pad either — every word should help the assignee act.`;

/**
 * Sprint 11 follow-up — notes rule. Notes is for context that the structured
 * fields (assigneeId, targetDate, priority) cannot carry. Not a dumping
 * ground for restated facts. Leave it empty when title + structured fields
 * already say it all.
 */
export const NOTES_RULE = `NOTES (optional)
Use notes only when the manager said context that the structured fields cannot carry — the why, the consequence, the dependency, the stakeholder. Leave notes empty when the title and structured fields (assigneeId, targetDate, priority) already convey everything.

  Manager said context that fits a structured field → put it there, not in notes.
    - The date the manager mentioned     → targetDate
    - The person the work is for         → already in title (preserve there) or assigneeId
    - "urgent" / "ASAP" / "abhi"         → priority
  Manager said context that no structured field carries → notes is the place.
    - "Dr. Mehta ke surgery ke liye"     → notes (stakeholder)
    - "Warna escalation ho jayegi"       → notes (consequence)
    - "Kyunki client meeting hai"        → notes (why)
    - "Last quarter ke results bhi check karna" → notes (dependency)

Don't restate the title in notes. Don't pad with conversational filler.`;

/**
 * Sprint 11 follow-up — worked examples for delegation. These teach Gemini
 * the input→output mapping for common relay patterns. Strong few-shot signal.
 * The examples cover: relay structure (X ko bolo Y ko Z), simple single-actor,
 * extra-context notes case, multi-assignee, self-task fallback, not-in-directory.
 */
export const DELEGATION_RELAY_EXAMPLES = `WORKED EXAMPLES (delegation patterns):

  Input: "Suresh ko bolo kal Subh bhaiya ko project update de dega"
    actions: [{
      type: "created",
      title: "Subh bhaiya ko project update dena hai",
      assigneeId: "<suresh-from-directory>",
      targetDate: "<tomorrow>",
      reasoning: "Suresh ko Subh bhaiya wala project update assign kiya"
    }]
    recommendations: []
    [notes omitted — assigneeId carries Suresh, targetDate carries kal, title carries the work]

  Input: "Anita ko bolo ki ward rounds kar le sham ko"
    actions: [{
      type: "created",
      title: "Sham ko ward rounds karne hain",
      assigneeId: "<anita-from-directory>",
      reasoning: "Anita ko sham ke rounds assign kiye"
    }]
    recommendations: []

  Input: "Vikram ko OT prep ka kaam de do urgent hai, Dr. Mehta ke 9am surgery ke liye"
    actions: [{
      type: "created",
      title: "OT prep karna hai",
      notes: "Dr. Mehta ke 9am surgery ke liye",
      priority: "high",
      assigneeId: "<vikram-from-directory>",
      reasoning: "Vikram ko urgent OT prep diya"
    }]
    recommendations: []
    [notes captures the stakeholder context (Dr. Mehta's surgery) that doesn't fit any structured field]

  Input: "Sneha ko reminder bhej do report submit karne hain kal tak warna escalation ho jayegi"
    actions: [{
      type: "created",
      title: "Report submit karne hain kal tak",
      notes: "Late hone par escalation",
      assigneeId: "<sneha-from-directory>",
      targetDate: "<tomorrow>",
      reasoning: "Sneha ko report submission reminder bheja"
    }]
    recommendations: []
    [notes captures the consequence — extra context]

  Input: "Sneha aur Amit ko ward 12 visit karna"
    actions: [
      { type: "created", title: "Ward 12 visit karna", assigneeId: "<sneha-id>", reasoning: "Sneha aur Amit ko assign kiya" },
      { type: "created", title: "Ward 12 visit karna", assigneeId: "<amit-id>",  reasoning: "Sneha aur Amit ko assign kiya" }
    ]
    recommendations: []
    [identical title, two assignees]

  Input: "muje khud ka ek note daalna hai"
    actions: [{
      type: "created",
      title: "Khud ka note daalna",
      assigneeId: "<SELF_USER_ID>",
      reasoning: "Apne liye add kiya"
    }]
    recommendations: []
    [self-task fallback when no team member is named]

  Input: "Rajesh ko bolo X karna hai"   (Rajesh NOT in directory)
    actions: []
    recommendations: [{
      title: "X karna hai",
      reasoning: "Rajesh aapki team me nahi mila — pehle add karoge?"
    }]
    [name mentioned but not in directory → recommendation, not action]`;
