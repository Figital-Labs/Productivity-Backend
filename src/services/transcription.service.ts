import { AI_THINKING_BUDGET, AI_TIMEOUT_MS, modelFor, temperatureFor } from "../lib/ai-config.js";
import { TRANSCRIBE_PROMPT } from "../lib/prompts/transcribe.js";
import { generateText } from "../lib/vertex.js";

export interface TranscribeAudioInput {
  buffer: Buffer;
  mimeType: string;
}

export interface TranscribeAudioResult {
  transcript: string;
}

/**
 * Sprint 17 — reusable verbatim transcription. No DB write, no
 * `VoiceInteraction` row, no task dispatch. Just audio bytes → text.
 *
 * The closure flow uses this to turn excuse voice clips into plain text
 * that the user can review and edit before final submit. Other surfaces
 * (note dictation, meeting voice memos, etc.) may reuse this later.
 */
export async function transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
  const transcript = await generateText({
    model: modelFor("transcribe"),
    prompt: TRANSCRIBE_PROMPT,
    media: [{ buffer: input.buffer, mimeType: input.mimeType }],
    temperature: temperatureFor("transcribe"),
    thinkingBudget: AI_THINKING_BUDGET.transcribe,
    timeoutMs: AI_TIMEOUT_MS.media,
    label: "transcribe",
  });
  return { transcript: transcript.trim() };
}
