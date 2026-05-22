/**
 * Builds the prompt for `POST /api/v1/process` — the true multimodal fusion
 * endpoint. The user may have submitted any combination of audio + image +
 * typed text in a single request; this prompt asks Gemini to read all
 * available modalities together and emit a single coherent extraction.
 *
 * Design notes:
 *   - The prompt is modality-aware: it explicitly tells Gemini which
 *     modalities are present in this call so the model doesn't hallucinate
 *     content from absent modalities.
 *   - Every action and recommendation MUST carry a `source` field naming
 *     which modality contributed it. This is the per-item provenance that
 *     fusion's single Vertex call would otherwise lose.
 *   - Cross-modal contradictions (audio says X, image shows ¬X) → route to
 *     recommendations, never to confident actions. This is the central
 *     hallucination-safety carryover from Sprints 5+6.
 */

import type { PendingTaskContext } from "./voice-intent.js";

export type { PendingTaskContext };

export interface BuildUnifiedIntentPromptArgs {
  pendingTasks: PendingTaskContext[];
  hasAudio: boolean;
  hasImage: boolean;
  text: string | undefined;
}

export function buildUnifiedIntentPrompt(args: BuildUnifiedIntentPromptArgs): string {
  const { pendingTasks, hasAudio, hasImage, text } = args;
  const taskListJson = JSON.stringify(pendingTasks, null, 2);

  const modalitiesList: string[] = [];
  if (hasAudio) modalitiesList.push("AUDIO (attached inline after this prompt)");
  if (hasImage) modalitiesList.push("IMAGE (attached inline after this prompt)");
  if (text !== undefined && text.length > 0) modalitiesList.push("TEXT (inlined below)");
  const modalitiesPresent =
    modalitiesList.length > 0 ? modalitiesList.join("\n- ") : "(none provided)";

  const userTextBlock =
    text !== undefined && text.length > 0 ? `USER TEXT:\n${text}\n` : `USER TEXT: (not provided)\n`;

  return `ROLE
You are a multimodal task management assistant for a multilingual Indian user (typically hospital staff). The user has submitted a morning task plan via one or more input modalities IN A SINGLE REQUEST. Read every available modality as ONE coherent input — they belong together, not in isolation. Extract intent across all of them.

MODALITIES PRESENT IN THIS REQUEST:
- ${modalitiesPresent}

Do NOT extract anything from a modality that is marked "(not provided)" — there is nothing to read.

INPUT LANGUAGE
Any modality may contain English, Hindi (Devanagari/Roman), or Hinglish (code-switched). Treat all three as equivalent. Match across modalities semantically — e.g., Hindi audio saying "report khatm kar di" can match an English task titled "Finish quarterly report".

OUTPUT LANGUAGE — IMPORTANT
ALL generated text (transcript, extractedText, titles, notes, reasoning) MUST be in Hinglish or English in Roman script. Do NOT use Devanagari or any other non-Latin script, regardless of input script.
  ✓ "Patient ke rounds complete karne hain"
  ✓ "Buy milk on the way home"
  ✗ "मरीज़ के राउंड पूरे करने हैं"   (Devanagari — never output)

INTENT TYPES (use exact "type" values):
  "created"            — user wants to add a new task
  "priority_updated"   — user wants to change priority of an existing task
  "completed"          — user marks an existing task as done
  "partial"            — user partially did an existing task (started but not finished)

SOURCE TAGGING — REQUIRED FOR EVERY ACTION AND RECOMMENDATION
Each action and recommendation MUST include a "source" field — exactly one of "voice", "image", or "text" — indicating which input modality led to that item:
  - "voice"  ← came from the audio
  - "image"  ← came from the photo / scanned task list
  - "text"   ← came from the typed text paragraph
If two modalities corroborate the same item (e.g., audio AND text both say "buy milk"), pick the modality that introduced it first in the user's mental order (typically audio if speaking, else image if reading off a page, else text).

RULES (in priority order):

1. CONSERVATIVE BY DEFAULT
   When uncertain, put the item in "recommendations", never "actions". Frontend confirms recommendations with the user before any DB write. When in doubt: RECOMMEND, never ACT.

2. CROSS-MODAL GROUNDING IS WELCOMED
   Use the modalities together. If voice or text says "the third item I wrote" and an image is attached, READ the image to identify what the third item is. If text references something visible in the image ("call the doctor I noted at the bottom"), link them.

3. CROSS-MODAL CONTRADICTIONS → ALWAYS RECOMMENDATION
   If audio says "I completed X" but the image shows X still unchecked or not crossed out, do NOT emit a confident "completed" action. Put it in "recommendations" so the user resolves the ambiguity. Same in reverse: if image shows a task struck through but audio describes it as ongoing, → recommendation. Note this in the reasoning.

4. EXISTING-TASK ACTIONS REQUIRE EXACT ID MATCH
   For "priority_updated" / "completed" / "partial", use the EXACT "id" from the pending-tasks list at the bottom of this prompt. Do NOT invent or guess ids. If no clear pending task matches, put it in "recommendations" instead.

5. AD-HOC WORK GOES TO RECOMMENDATIONS
   If any modality mentions doing or planning something that isn't in the pending-tasks list, do NOT auto-create it. Put it in "recommendations" with the appropriate fields and clear reasoning. The user will confirm via UI.

6. CREATED ACTIONS — title (mandatory) + notes (optional)
   - "title": concise summary, max ~80 chars, Hinglish/English Roman
   - "notes": OPTIONAL longer context, max ~500 chars — include only if a modality offered detail beyond the title (the why, the when, who it's for, dependencies)

7. PRIORITY
   Allowed values: "low", "medium", "high". Omit if no priority signal.
   Cues across modalities:
     - Audio/text: "urgent", "ASAP", "जरूरी", "abhi karna hai", "important", swearing
     - Image: "URGENT" / "!!!" in handwriting, underlines, stars (*, ★), red ink, double-underlining

8. VISUAL COMPLETION CUES (image only, subject to rule 3 if other modalities disagree)
   Checkmark (✓), strikethrough, "DONE" / "OK" / "✔" next to an item → matches the pending task by title → emit "completed". If no pending task matches, → recommendation with completed=true.

9. REASONING IS MANDATORY AND CITES MODALITY CUES
   Every action and every recommendation must include a "reasoning" string (Hinglish/English) explaining WHY you classified it — what cue led to it, citing the specific modality content (e.g., "User said 'urgent' in audio", "Image shows '✓' next to item 3", "Text paragraph mentioned this between commas"). This IS the audit trail; do NOT also output a separate transcript or extractedText field — actions' reasoning carries the relevant excerpts where they matter.

10. EMPTY / OFF-TOPIC INPUT
    If no task-related content exists across any provided modality, return empty "actions" and "recommendations" arrays.

${userTextBlock}
CURRENT PENDING TASKS:
${taskListJson}
`;
}
