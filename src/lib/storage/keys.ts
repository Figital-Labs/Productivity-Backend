/**
 * Media key construction. Every object lives under `[<prefix>/]<surface>/<orgId>/<ownerId>/`
 * so keys are surface-, tenant-, and owner-namespaced — this enables per-surface S3 lifecycle
 * rules (meeting audio vs throwaway captures), IAM `Resource` scoping, and a cheap "caller owns
 * this key" check before the worker reads an object. `MEDIA_KEY_PREFIX` is OPTIONAL: leave it
 * empty for a bucket dedicated to this app (keys start at `<surface>/…`); set it to share a
 * bucket. Extensions derive from the same MIME whitelist the upload middleware uses (one source
 * of truth), and tolerate a `;codecs=…` suffix.
 */
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";

/** Media surfaces — the second key segment, so retention can differ per type. */
export type MediaSurface = "meetings" | "voice" | "image" | "unified";

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  // iOS Safari records MP4/AAC, not WebM/Opus — keep the backend format-agnostic.
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** Strip any `;codecs=…` parameter to the base MIME type. */
function baseMime(mime: string): string {
  return mime.split(";")[0]?.trim() ?? "";
}

/** Map an upload MIME type to a file extension; unlisted types fall back to `bin`. */
export function extFromMime(mime: string): string {
  return EXT_BY_MIME[baseMime(mime)] ?? "bin";
}

/** True for any audio/image MIME we accept (a `;codecs=…` suffix is tolerated). */
export function isSupportedMediaMime(mime: string): boolean {
  return baseMime(mime) in EXT_BY_MIME;
}

/** Optional top-level prefix segment — empty (no trailing slash) for a dedicated bucket. */
function keyRoot(): string {
  return env.mediaKeyPrefix ? `${env.mediaKeyPrefix}/` : "";
}

/**
 * `[<prefix>/]<surface>/<orgId>/<ownerId>/<uuid>.<ext>` — unique, namespaced, vendor-agnostic.
 * `ownerId` is the meetingId for meetings, the userId for captures.
 */
export function buildMediaKey(
  surface: MediaSurface,
  orgId: string,
  ownerId: string,
  mime: string,
): string {
  return `${keyRoot()}${surface}/${orgId}/${ownerId}/${randomUUID()}.${extFromMime(mime)}`;
}

/** The prefix every object for one owner+surface lives under — used to reject foreign keys. */
export function mediaKeyPrefix(surface: MediaSurface, orgId: string, ownerId: string): string {
  return `${keyRoot()}${surface}/${orgId}/${ownerId}/`;
}

/** Last path segment of a key — a sensible download filename. */
export function filenameFromKey(key: string): string {
  return key.split("/").pop() ?? "download";
}
