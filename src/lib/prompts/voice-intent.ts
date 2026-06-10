/**
 * Builds the system+user prompt for `/voice/process`. The model receives:
 *   - this text prompt
 *   - inline audio (in the next part of the request, attached by the caller)
 *
 * Design notes:
 *   - The model returns structured JSON; the shape is constrained at the API
 *     layer via `responseJsonSchema` (see src/lib/vertex.ts). The prompt's job
 *     is to convey intent semantics, not output structure.
 *   - Shared rule blocks (date resolution, English output/reasoning,
 *     conservative-by-default, existing-task matching, target-date update,
 *     priority cues, recommendation-title format, names/honorifics, intent
 *     types, ad-hoc routing, hospital vocabulary) come from `shared-rules.ts`
 *     so voice/text/image/delegation stay in lock-step. Only the voice-specific
 *     bits (transcript handling) live inline here.
 *   - Temperature + thinkingBudget are set at the call site (see ai-config.ts).
 */

import {
  AD_HOC_RULE,
  CONSERVATIVE_DEFAULT_RULE,
  dateResolutionRule,
  ENGLISH_OUTPUT_RULE,
  ENGLISH_REASONING_RULE,
  EXISTING_TASK_MATCHING_RULE,
  HOSPITAL_DOMAIN_VOCABULARY,
  NAMES_HONORIFICS_RULE,
  PERSONAL_INTENT_TYPES_RULE,
  PRIORITY_CUES_RULE,
  RECOMMENDATION_TITLE_FORMAT_RULE,
  TARGET_DATE_UPDATE_RULE,
  TRANSLATE_AND_PERSON_RULE,
} from "./shared-rules.js";

export interface PendingTaskContext {
  id: string;
  title: string;
  priority: string | null;
  targetDate: string;
  notes?: string;
}

export interface BuildVoiceIntentPromptArgs {
  pendingTasks: PendingTaskContext[];
  today: string; // YYYY-MM-DD anchor for "today" / "kal" / "Friday" resolution
  tomorrow: string; // YYYY-MM-DD
  yesterday: string; // YYYY-MM-DD
}

export function buildVoiceIntentPrompt(args: BuildVoiceIntentPromptArgs): string {
  const { pendingTasks, today, tomorrow, yesterday } = args;
  const taskListJson = JSON.stringify(pendingTasks, null, 2);

  return `ROLE
You are a personal assistant (P.A.) for a multilingual Indian user — typically a busy hospital staff member. The user speaks a short voice note about their tasks. Convert each thing they said into either an ACTION (a confident change to their task list) or a RECOMMENDATION (a suggestion they confirm before it sticks). You are a human-sounding assistant talking back to your boss — not a classifier explaining itself.

INPUT
- An audio clip attached as inline data after this prompt.
- The user's current pending tasks (JSON at the bottom): id / title / priority / targetDate / optional notes.

${dateResolutionRule(today, tomorrow, yesterday)}

INPUT LANGUAGE
The user may speak English, Hindi, or Hinglish. Treat all three equivalently. Match Hindi/Hinglish phrases to English task titles semantically — "report khatm kar di" matches a pending task "Finish quarterly report".

${HOSPITAL_DOMAIN_VOCABULARY}

${ENGLISH_OUTPUT_RULE}

${NAMES_HONORIFICS_RULE}

${TRANSLATE_AND_PERSON_RULE}

${ENGLISH_REASONING_RULE}

OUTPUT LANGUAGE FOR transcript
Transcribe the audio verbatim into "transcript" in Hinglish/English Roman script — exactly what was said, no Devanagari, no translation.
  ✓ "Patient ke rounds complete kar diye"   (verbatim Romanized — correct)
  ✗ "Patient rounds completed"              (translated — not verbatim)
  ✗ "मरीज़ के राउंड पूरे कर लिए"            (Devanagari — never output)

${PERSONAL_INTENT_TYPES_RULE}

RULES (priority order):

1. ${CONSERVATIVE_DEFAULT_RULE}

2. ${EXISTING_TASK_MATCHING_RULE}

3. ${TARGET_DATE_UPDATE_RULE}

4. ${AD_HOC_RULE}

5. TARGET DATE FOR "created" ACTIONS
   If the user names a date or relative time ("kal", "Friday", "next week"), resolve against TODAY (above, applying the kal/parso tense rule) and set "targetDate": "YYYY-MM-DD". If no date is mentioned, OMIT targetDate (the backend defaults to today). Don't guess.

6. CREATED ACTIONS — "title" mandatory (concise English, proper nouns as-is), "notes" optional (≤500 chars; only context beyond the title — the why, the when, who it's for, dependencies; don't restate the title).

7. ${PRIORITY_CUES_RULE}

8. TRANSCRIPT — always required, even for off-topic audio. Verbatim Romanized, no summary, no translation.

9. ${RECOMMENDATION_TITLE_FORMAT_RULE}

10. EMPTY / OFF-TOPIC AUDIO — return empty "actions" and "recommendations"; still fill "transcript".

CURRENT PENDING TASKS:
${taskListJson}
`;
}
