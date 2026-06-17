/**
 * Media key construction. Every object lives under
 * `${MEDIA_KEY_PREFIX}/${orgId}/${userId}/` so keys are tenant- and user-namespaced —
 * this enables IAM `Resource` scoping, per-prefix S3 lifecycle rules, and a cheap
 * "caller owns this key" check before the worker reads an object. Extensions derive from
 * the same MIME whitelist used by the upload middleware (one source of truth).
 */
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Map an upload MIME type to a file extension; unlisted types fall back to `bin`. */
export function extFromMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

/** `media/<orgId>/<userId>/<uuid>.<ext>` — unique, namespaced, vendor-agnostic. */
export function buildMediaKey(orgId: string, userId: string, ext: string): string {
  return `${env.s3.keyPrefix}/${orgId}/${userId}/${randomUUID()}.${ext}`;
}
