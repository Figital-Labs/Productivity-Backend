import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../config/env.js";
import { UpstreamError } from "../errors.js";

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

/**
 * Minimal S3 access for the meeting audio-audit trail (ADR/Wave 2). We persist each
 * uploaded clip so a "the summary is wrong" complaint can be answered by listening to
 * exactly what the user recorded. NOT the scaling worker/queue — just upload + presign.
 *
 * Entirely optional: if the AWS env vars aren't set, `env.s3` is null, every call is a
 * no-op, and meeting processing proceeds unchanged (mediaKeys stays empty).
 */
const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function extFromMime(mime: string): string {
  return EXT_BY_MIME[mime.split(";")[0]?.trim() ?? ""] ?? "bin";
}

const config = env.s3;
const client =
  config !== null
    ? new S3Client({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      })
    : null;

export function isStorageConfigured(): boolean {
  return client !== null;
}

/** `<prefix>/<orgId>/<meetingId>/<uuid>.<ext>` — one object per clip/upload. */
export function buildMeetingMediaKey(orgId: string, meetingId: string, mimeType: string): string {
  const prefix = config?.keyPrefix ?? "meetings";
  return `${prefix}/${orgId}/${meetingId}/${randomUUID()}.${extFromMime(mimeType)}`;
}

export async function uploadMedia(key: string, body: Buffer, contentType: string): Promise<void> {
  if (client === null || config === null) return;
  await client.send(
    new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/**
 * Short-lived presigned GET so an admin can listen to / download a stored clip. Pass
 * `downloadFilename` to make the link force a download (Content-Disposition: attachment)
 * instead of streaming inline — a plain navigation, so no bucket CORS is required.
 */
export async function signedGetUrl(
  key: string,
  ttlSeconds = 900,
  opts?: { downloadFilename?: string },
): Promise<string | null> {
  if (client === null || config === null) return null;
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ...(opts?.downloadFilename !== undefined
        ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"` }
        : {}),
    }),
    { expiresIn: ttlSeconds },
  );
}

/** True for any audio/image MIME we support (codecs suffix tolerated). */
export function isSupportedMediaMime(mime: string): boolean {
  const base = mime.split(";")[0]?.trim() ?? "";
  return base in EXT_BY_MIME;
}

/** The key prefix every clip of a meeting lives under — used to reject foreign keys. */
export function meetingMediaKeyPrefix(orgId: string, meetingId: string): string {
  const prefix = config?.keyPrefix ?? "meetings";
  return `${prefix}/${orgId}/${meetingId}/`;
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
}

/**
 * Presigned POST so the browser uploads a clip straight to S3 (server never sees the
 * bytes). The POST Policy enforces a max size and the exact Content-Type, restoring the
 * validation we'd otherwise lose by bypassing multer. Returns null if S3 isn't configured.
 */
export async function createPresignedUpload(
  key: string,
  contentType: string,
): Promise<PresignedUpload | null> {
  if (client === null || config === null) return null;
  const { url, fields } = await createPresignedPost(client, {
    Bucket: config.bucket,
    Key: key,
    Conditions: [["content-length-range", 1, MAX_MEDIA_BYTES]],
    Fields: { "Content-Type": contentType },
    Expires: 300,
  });
  return { url, fields, key };
}

/** Download a clip's bytes (to inline to Gemini, which can't read s3://). */
export async function downloadMedia(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (client === null || config === null) {
    throw new UpstreamError("S3_NOT_CONFIGURED", "Object storage is not configured.");
  }
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (bytes === undefined) {
      throw new UpstreamError("S3_DOWNLOAD_FAILED", "Stored clip was empty.");
    }
    return {
      buffer: Buffer.from(bytes),
      contentType: res.ContentType ?? "application/octet-stream",
    };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError("S3_DOWNLOAD_FAILED", "Could not read a stored clip from storage.");
  }
}

/** Delete a single object — for clips the user discards after they uploaded. */
export async function deleteMedia(key: string): Promise<void> {
  if (client === null || config === null) return;
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
