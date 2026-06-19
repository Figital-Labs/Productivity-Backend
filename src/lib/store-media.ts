/**
 * Best-effort audit storage for the synchronous capture surfaces (voice / image, personal +
 * team). The clip/image is uploaded to S3 AFTER the AI call so a storage hiccup never fails the
 * result the user is waiting on, and the returned key is persisted on the interaction row
 * (`audioUrl` / `imageUrl`). Captures upload server-side (backend→S3 — no browser CORS), so
 * there's no presigned/direct path here; that's only worth it for long meeting audio.
 */
import { log } from "./logger.js";
import { storage } from "./storage/index.js";
import { buildMediaKey, type MediaSurface } from "./storage/keys.js";

export async function storeCaptureMedia(
  surface: MediaSurface,
  orgId: string,
  userId: string,
  media: { buffer: Buffer; mimeType: string },
): Promise<string | null> {
  try {
    const key = buildMediaKey(surface, orgId, userId, media.mimeType);
    await storage.upload(key, media.buffer, {
      contentType: media.mimeType,
      contentLength: media.buffer.length,
    });
    return key;
  } catch (err) {
    log.warn("capture", "media store failed (continuing without audit copy)", {
      surface,
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
