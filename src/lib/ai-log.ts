/**
 * Tier-1 raw AI-output logging. When a user reports "the AI missed my task,"
 * a miss is usually a *successful* Gemini call that returned the wrong thing —
 * so we log the raw model text (pre-parse) keyed by surface + user. This is the
 * single highest-leverage debugging hook for the extraction flows.
 *
 * Pass the returned closure as `onRaw` to `generateStructured` / `generateText`.
 * Swap `console` for the app logger if/when one is introduced.
 */
export function logRaw(surface: string, userId: string): (raw: string) => void {
  return (raw: string) => {
    console.info(`[ai-raw] surface=${surface} user=${userId} len=${raw.length.toString()}`, raw);
  };
}

/**
 * Tier-1 *input* logging — the counterpart to logRaw. The "user processed a meeting
 * and got an empty summary" class of bug is almost always empty/silent audio that
 * never carried speech — but you can't tell that after the fact unless you record
 * what actually went INTO the model. Logs clip count + per-clip byte size + mime +
 * notes length, keyed by surface + user, right before the Vertex call. Pair with the
 * `[ai-meta]` (token counts) and `[ai-raw]` (output) lines to triage a bad result.
 */
export interface AiInputMedia {
  bytes: number;
  mimeType: string;
}

export interface AiInputShape {
  audio: AiInputMedia[];
  images: AiInputMedia[];
  notesLen: number;
}

export function logInput(surface: string, userId: string, shape: AiInputShape): void {
  const audioBytes = shape.audio.map((a) => a.bytes);
  const totalAudioBytes = audioBytes.reduce((sum, b) => sum + b, 0);
  const mimes = [...shape.audio, ...shape.images].map((m) => m.mimeType).join("|");
  console.info(
    `[ai-input] surface=${surface} user=${userId} ` +
      `audioClips=${audioBytes.length.toString()} ` +
      `audioBytes=[${audioBytes.join(",")}] ` +
      `totalAudioBytes=${totalAudioBytes.toString()} ` +
      `images=${shape.images.length.toString()} ` +
      `notesLen=${shape.notesLen.toString()} mimes=${mimes}`,
  );
}
