import { z } from "zod";

import { priorityEnum } from "./common.js";

/**
 * AI output schema for `POST /api/v1/process` (true multimodal fusion).
 *
 * Differences from voice/image schemas:
 *   - Every action and recommendation carries a `source` field — one of
 *     "voice" | "image" | "text" — indicating which input modality contributed
 *     it. This is for audit + frontend UI hints; the persisted Task row gets
 *     `sourceType: "unified"` regardless.
 *   - NO `transcript` or `extractedText` fields. The fusion endpoint
 *     deliberately doesn't ask the model to also be an OCR/STT machine — the
 *     per-action `reasoning` field captures "what was extracted from each
 *     modality" inline where it matters. Dropping these fields avoids the
 *     two-step cascade (OCR → action extraction) that compounds errors. See
 *     ADR-0021 for the rationale.
 *
 * Used both as Vertex's `responseJsonSchema` AND for post-call validation
 * (UpstreamError contract — drift surfaces loudly).
 */

export const sourceModalityEnum = z.enum(["voice", "image", "text"]);
export type SourceModality = z.infer<typeof sourceModalityEnum>;

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");

/**
 * Input form-field schema for `POST /api/v1/process`. Modality buffers (audio,
 * image) and the typed text are handled in the controller; `targetDate` is an
 * optional form field that anchors both the AI prompt's TODAY and the
 * dispatcher's default target date.
 */
export const submitUnifiedInputSchema = z.object({
  text: z.string().min(1).optional(),
  targetDate: ymdDateSchema.optional(),
});
export type SubmitUnifiedInput = z.infer<typeof submitUnifiedInputSchema>;

export const unifiedActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("created"),
    source: sourceModalityEnum,
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    priority: priorityEnum.optional(),
    targetDate: ymdDateSchema.optional(),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("priority_updated"),
    source: sourceModalityEnum,
    taskId: z.string().min(1),
    priority: priorityEnum,
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("completed"),
    source: sourceModalityEnum,
    taskId: z.string().min(1),
    reasoning: z.string(),
  }),
  z.object({
    type: z.literal("partial"),
    source: sourceModalityEnum,
    taskId: z.string().min(1),
    reasoning: z.string(),
  }),
]);
export type UnifiedAction = z.infer<typeof unifiedActionSchema>;

export const unifiedRecommendationSchema = z.object({
  source: sourceModalityEnum,
  title: z.string().min(1),
  priority: priorityEnum.optional(),
  completed: z.boolean().optional(),
  reasoning: z.string(),
});
export type UnifiedRecommendation = z.infer<typeof unifiedRecommendationSchema>;

export const unifiedIntentResponseSchema = z.object({
  actions: z.array(unifiedActionSchema),
  recommendations: z.array(unifiedRecommendationSchema),
});
export type UnifiedIntentResponse = z.infer<typeof unifiedIntentResponseSchema>;
