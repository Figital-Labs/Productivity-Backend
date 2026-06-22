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
