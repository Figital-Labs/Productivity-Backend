import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { env } from "../config/env.js";

import { UpstreamError } from "./errors.js";

/**
 * Single GoogleGenAI client for the lifetime of the process. Constructed with
 * Vertex AI credentials parsed at boot in `src/config/env.ts`. Reuse this
 * instance across every Vertex call — the SDK manages its own request pool.
 */
const ai = new GoogleGenAI({
  vertexai: true,
  project: env.gcp.project,
  location: env.gcp.location,
  googleAuthOptions: { credentials: env.gcp.credentials },
});

export const GEMINI_FLASH_MODEL = "gemini-2.5-flash";

export interface InlineMedia {
  mimeType: string;
  buffer: Buffer;
}

export interface GenerateStructuredOptions<S extends z.ZodType> {
  model: string;
  prompt: string;
  schema: S;
  media?: InlineMedia[];
}

/**
 * One-shot multimodal generation with structured output.
 *
 * The zod schema is converted to JSON Schema and sent to Gemini as
 * `responseJsonSchema` (SDK ≥1.9.0), which constrains the model's output shape
 * at decode time. We then re-parse the response with the same zod schema so
 * the value type is exact at the call site and any drift between Gemini and
 * the schema surfaces as an `UpstreamError`, not silent type drift.
 */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function generateStructured<S extends z.ZodType>(
  opts: GenerateStructuredOptions<S>,
): Promise<z.infer<S>> {
  const parts: GeminiPart[] = [{ text: opts.prompt }];

  for (const m of opts.media ?? []) {
    parts.push({
      inlineData: { mimeType: m.mimeType, data: m.buffer.toString("base64") },
    });
  }

  const response = await ai.models.generateContent({
    model: opts.model,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(opts.schema),
    },
  });

  const text = response.text;
  if (typeof text !== "string" || text.length === 0) {
    throw new UpstreamError("AI_EMPTY_RESPONSE", "Vertex returned no text content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UpstreamError("AI_INVALID_JSON", "Vertex response was not valid JSON.", {
      raw: text,
    });
  }

  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new UpstreamError(
      "AI_SCHEMA_MISMATCH",
      "Vertex response did not match the expected schema.",
      { issues: result.error.issues as unknown as Record<string, unknown> },
    );
  }
  return result.data;
}
