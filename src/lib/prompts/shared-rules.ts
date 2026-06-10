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
 *
 * Language policy update: all user-facing output (title, notes, reasoning,
 * summary) must be in English regardless of input language. transcript and
 * extractedText fields stay as Romanized verbatim (no Devanagari).
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
 * Output language rule for the user-facing `reasoning` field.
 * Always English regardless of input language.
 */
export const ENGLISH_REASONING_RULE = `OUTPUT LANGUAGE FOR reasoning — ALWAYS ENGLISH
This reasoning is shown DIRECTLY to the user on the recommendation card. Always write in clear, simple English regardless of the user's input language.

  - LENGTH: 1 short sentence, ≤ 20 words. No preamble. No rule references.
  - LANGUAGE: English only. Never Devanagari. Never Hinglish.
  - TONE: warm, direct, helpful — like a smart teammate. No academic phrasing.

  ✓ "Already in your list — duplicate?"
  ✓ "Assigned to Sister Sneha."
  ✓ "Couldn't find that name in your team."
  ✓ "Heard 'urgent' — set priority to high."
  ✓ "Tense was unclear — please confirm."
  ✗ "Aapke list me already hai" (Hinglish — never output)
  ✗ "मरीज़ का काम पहले से है।" (Devanagari — never output)`;

/**
 * Output language rule for `title` / `notes` fields — always English,
 * never Devanagari or Hinglish, even when the input was in Hindi/Hinglish.
 * Proper nouns and names (Sneha, Dr. Mehta, Ward 12) stay as-is.
 */
export const ENGLISH_OUTPUT_RULE = `OUTPUT LANGUAGE FOR title / notes — ALWAYS ENGLISH
ALL task titles and notes MUST be in clear, simple English. Never use Devanagari, Hinglish, or Hindi Roman script — translate the intent naturally into English.
Proper nouns (names like Sneha, Suresh, Dr. Mehta; place names like Ward 12, OT; dept names) are kept as-is.
  ✓ "Complete patient rounds"
  ✓ "Submit quarterly report"
  ✓ "Give project update to Subh bhaiya"
  ✓ "Ward 12 visit"
  ✗ "Patient ke rounds complete karne hain" (Hinglish — never output)
  ✗ "मरीज़ के राउंड पूरे करने हैं"          (Devanagari — never output)`;

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

  ✓ Input: "Sneha se baat karna hai - Monday ko karna hai" + existing task "Talk to Sneha"
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
A recommendation's "title" follows the same shape as an action's title (see TITLE rule): it must carry the full clear intent of the task in English — not a question, not a "Shift X to Y?" prompt, not a sentence with quoted strings inside it.

  ✓ "Talk to Sneha"
  ✓ "Submit quarterly report"
  ✓ "Ward 12 round (Monday)"
  ✗ "Shift 'Sneha se baat karna hai' (today's task) to tomorrow?"
  ✗ "Did you mean to create a new task for X?"
  ✗ "Add task: Talk to Sneha"

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
The title carries the full clear intent of the task in English — what the assignee needs to do, including the key context the manager said. The assignee opens their task list later and reads only the title; it must let them act without going back to the manager.
Proper nouns (names, ward numbers, dept names) stay as-is.

  ✓ "Give project update to Subh bhaiya"       (preserves the recipient context)
  ✓ "Ward 12 visit"                             (simple case, terse OK)
  ✓ "Submit report by tomorrow"                 (preserves the deadline)
  ✓ "Ward rounds in the evening"                (preserves the time-of-day)
  ✗ "Project update dena"                       (Hinglish — never output)
  ✗ "Update"                                    (too thin to act on)
  ✗ "Shift X to Y?"                             (question, not a task)
  ✗ "Add task: Ward 12 visit"                   (meta-phrasing, not the task)

Keep titles concise and to the point. Don't reduce to a vague noun-phrase that loses what the manager wants to happen. Don't pad either — every word should help the assignee act.`;

/**
 * Sprint 11 follow-up — notes rule. Notes is for context that the structured
 * fields (assigneeId, targetDate, priority) cannot carry. Not a dumping
 * ground for restated facts. Leave it empty when title + structured fields
 * already say it all.
 */
export const NOTES_RULE = `NOTES (optional)
Use notes only when the manager said context that the structured fields cannot carry — the why, the consequence, the dependency, the stakeholder. Leave notes empty when the title and structured fields (assigneeId, targetDate, priority) already convey everything.
Notes must be in English.

  Manager said context that fits a structured field → put it there, not in notes.
    - The date the manager mentioned     → targetDate
    - The person the work is for         → already in title (preserve there) or assigneeId
    - "urgent" / "ASAP" / "abhi"         → priority
  Manager said context that no structured field carries → notes is the place.
    - "For Dr. Mehta's surgery"          → notes (stakeholder)
    - "Escalation will follow if late"   → notes (consequence)
    - "Client meeting is the reason"     → notes (why)
    - "Also check last quarter's results" → notes (dependency)

Don't restate the title in notes. Don't pad with conversational filler.`;

/**
 * Sprint 11 follow-up — worked examples for delegation. These teach Gemini
 * the input→output mapping for common relay patterns. Strong few-shot signal.
 * The examples cover: relay structure (X ko bolo Y ko Z), simple single-actor,
 * extra-context notes case, multi-assignee, self-task fallback, not-in-directory.
 * All output fields (title, reasoning, notes) are in English.
 */
export const DELEGATION_RELAY_EXAMPLES = `WORKED EXAMPLES (delegation patterns):

  Input: "Suresh ko bolo kal Subh bhaiya ko project update de dega"
    actions: [{
      type: "created",
      title: "Give project update to Subh bhaiya",
      assigneeId: "<suresh-from-directory>",
      targetDate: "<tomorrow>",
      reasoning: "Assigned project update for Subh bhaiya to Suresh"
    }]
    recommendations: []
    [notes omitted — assigneeId carries Suresh, targetDate carries kal, title carries the work]

  Input: "Anita ko bolo ki ward rounds kar le sham ko"
    actions: [{
      type: "created",
      title: "Ward rounds in the evening",
      assigneeId: "<anita-from-directory>",
      reasoning: "Assigned evening ward rounds to Anita"
    }]
    recommendations: []

  Input: "Vikram ko OT prep ka kaam de do urgent hai, Dr. Mehta ke 9am surgery ke liye"
    actions: [{
      type: "created",
      title: "OT prep",
      notes: "For Dr. Mehta's 9am surgery",
      priority: "high",
      assigneeId: "<vikram-from-directory>",
      reasoning: "Assigned urgent OT prep to Vikram"
    }]
    recommendations: []
    [notes captures the stakeholder context (Dr. Mehta's surgery) that doesn't fit any structured field]

  Input: "Sneha ko reminder bhej do report submit karne hain kal tak warna escalation ho jayegi"
    actions: [{
      type: "created",
      title: "Submit report by tomorrow",
      notes: "Escalation will follow if late",
      assigneeId: "<sneha-from-directory>",
      targetDate: "<tomorrow>",
      reasoning: "Assigned report submission reminder to Sneha"
    }]
    recommendations: []
    [notes captures the consequence — extra context]

  Input: "Sneha aur Amit ko ward 12 visit karna"
    actions: [
      { type: "created", title: "Ward 12 visit", assigneeId: "<sneha-id>", reasoning: "Assigned Ward 12 visit to Sneha and Amit" },
      { type: "created", title: "Ward 12 visit", assigneeId: "<amit-id>",  reasoning: "Assigned Ward 12 visit to Sneha and Amit" }
    ]
    recommendations: []
    [identical title, two assignees]

  Input: "muje khud ka ek note daalna hai"
    actions: [{
      type: "created",
      title: "Add personal note",
      assigneeId: "<SELF_USER_ID>",
      reasoning: "Added as a self-task"
    }]
    recommendations: []
    [self-task fallback when no team member is named]

  Input: "Rajesh ko bolo X karna hai"   (Rajesh NOT in directory)
    actions: []
    recommendations: [{
      title: "X",
      reasoning: "Rajesh not found in your team — add them first?"
    }]
    [name mentioned but not in directory → recommendation, not action]`;

/**
 * Hospital shorthand glossary. Added so the model resolves clinical terms
 * reliably and keeps the shorthand intact in titles (staff read "OT"/"ICU"
 * fine — don't expand them). Consumed by the personal, delegation, and
 * meeting prompts.
 */
export const HOSPITAL_DOMAIN_VOCABULARY = `HOSPITAL VOCABULARY (common shorthand — interpret correctly, keep terms as-is in titles)
  - "rounds" / "ward rounds"   → visiting admitted patients ward by ward
  - "OPD"                      → Out-Patient Department
  - "OT"                       → Operation Theatre
  - "ICU" / "NICU" / "CCU"     → intensive care units
  - "discharge" / "DAMA"       → sending a patient home (DAMA = discharge against medical advice)
  - "handover"                 → passing duty to the next shift
  - "vitals"                   → BP, pulse, temperature, SpO2
  - "on-call"                  → staff reachable for emergencies
  - "indent"                   → raising a supply/medicine request
  - "case sheet" / "OPD slip"  → patient paperwork
  - "consultant" / "HOD"       → senior doctor / Head of Department
  - "sister"                   → a nurse ("Sister Sneha" = a nurse named Sneha)
Don't expand shorthand in titles — staff read "OT", "ICU", "rounds" fine.`;

/**
 * Name + honorific preservation. Previously duplicated inline across the three
 * personal prompts; lifted here so they share one source of truth.
 */
export const NAMES_HONORIFICS_RULE = `NAMES AND HONORIFICS — preserve exactly as the user said them:
  - Personal names (Sneha, Suresh, Shubh, Dr. Mehta) — always keep as-is.
  - Indian honorifics WITH a name ("Sir", "Madam", "Bhai/Bhaiya", "Didi", "Ji") — keep the FULL name+honorific pair. Never drop the name and keep only the honorific.
    ✓ "Subh Sir ko project overview dena hai" → "Give project overview to Subh Sir"
    ✗ "Project update to sir"  ← WRONG: dropped "Subh", changed "overview" to "update"
    ✓ "Sneha didi ko report bhejna hai"       → "Send report to Sneha Didi"
    ✗ "Send report to didi"   ← WRONG: dropped "Sneha"
  - Place names (Ward 12, OT, ICU, Room 402) — keep as-is.`;

/**
 * Faithful translation + always include the person's name in person-specific
 * task titles. Lifted from the personal prompts' inline copies.
 */
export const TRANSLATE_AND_PERSON_RULE = `TRANSLATE FAITHFULLY — the user's words, not synonyms or summaries:
  ✓ "project ka overview dena" → "Give project overview"  (not "project update")
  ✓ "bill banana hai"          → "Prepare bill"           (not "billing")
  ✓ "baat karna hai"           → "Talk to"                (not "meet" or "contact")

PERSON-SPECIFIC TASKS — always include the person's name in the title:
  ✓ "Subh Sir ko project ka overview dena hai" → "Give project overview to Subh Sir"
  ✓ "Suresh ka bill banana hai"                → "Prepare Suresh's bill"
  ✓ "Sneha se baat karna hai"                  → "Talk to Sneha"
  ✓ "Dr. Mehta ko report bhejna hai"           → "Send report to Dr. Mehta"`;

/**
 * The five intent types for the personal capture flows (voice/text/image),
 * with the Hinglish partial-completion cues. Image extraction appends its own
 * visual cues on top of this.
 */
export const PERSONAL_INTENT_TYPES_RULE = `INTENT TYPES (use exact "type" values):
  "created"             — add a new task
  "priority_updated"    — change the priority of an existing task
  "completed"           — mark an existing task as done
  "partial"             — partially did an existing task (started, not finished).
                          Cues: "half kiya", "adha hua", "50% ho gaya", "thoda kiya",
                          "chal raha hai", "almost done", "thoda baki hai",
                          "kaafi progress hui", "shuru kar diya", "bich mein hai"
  "target_date_updated" — MOVE an existing task to a different date (not a duplicate, not done)`;

/**
 * Ad-hoc work (not on the pending list) routes to recommendations, never a
 * silent auto-create. Lifted from the personal prompts' inline copies.
 */
export const AD_HOC_RULE = `AD-HOC COMPLETED WORK → RECOMMENDATIONS
If the user reports having ALREADY DONE something that isn't on their pending list (e.g., "maine aaj extra emergency triage bhi kiya"), do NOT silently create-and-complete it. Put it in "recommendations" with completed=true and a brief reasoning so the user confirms adding it.
This rule is ONLY about already-done work that's missing from the list. New forward-looking tasks the user wants to add are normal "created" actions — capture them, don't downgrade them to recommendations.`;
