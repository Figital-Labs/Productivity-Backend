import { z } from "zod";

/**
 * Voice / image task capture (async pipeline, mirrors meetings). One surface set so the presign,
 * process, and result routes stay generic over the two modalities. `text` stays synchronous and is
 * NOT a capture surface (no blob to upload).
 */
export const captureSurfaceEnum = z.enum(["voice", "image"]);
export type CaptureSurface = z.infer<typeof captureSurfaceEnum>;

const ymdDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "targetDate must be YYYY-MM-DD");

/** Body for `POST /captures/presign` — mint a direct browser→S3 upload for a capture object. */
export const capturePresignSchema = z.object({
  surface: captureSurfaceEnum,
  contentType: z.string().min(1).max(120),
});
export type CapturePresignInput = z.infer<typeof capturePresignSchema>;

/**
 * Body for `POST /captures/process`. The media arrives one of two ways: `key` (the object the
 * browser already uploaded direct-to-S3 via presign) OR a multipart `file` (byte fallback when the
 * driver can't presign / S3 CORS is off — handled in the controller). `surface` + optional
 * `targetDate` come as JSON fields or multipart form fields either way.
 */
export const captureProcessSchema = z.object({
  surface: captureSurfaceEnum,
  key: z.string().min(1).max(512).optional(),
  targetDate: ymdDateSchema.optional(),
});
export type CaptureProcessInput = z.infer<typeof captureProcessSchema>;
