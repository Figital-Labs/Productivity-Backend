/**
 * `S3Storage` — the concrete `BlobStorage` over AWS S3 (ADR-0023). Wraps the AWS SDK v3
 * client so call sites depend on our interface, not the vendor SDK (Adapter pattern).
 * Failures become `UpstreamError` (→ 502) so they flow through the central error
 * middleware exactly like other downstream failures (e.g. Vertex).
 */
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
import { log } from "../logger.js";

import {
  MAX_MEDIA_BYTES,
  type BlobMeta,
  type BlobStorage,
  type PresignedUpload,
  type SignedGetOptions,
} from "./index.js";

// Lazily build the client + read the bucket on first use. Module-level access to `env.s3`
// would crash under the disk driver (this file is statically imported either way), so we keep
// it lazy — S3Storage is only ever instantiated under STORAGE_DRIVER=s3, so the throw is
// unreachable in practice but keeps the module import-safe and avoids a non-null assertion.
let cachedClient: S3Client | null = null;
function s3ctx(): { client: S3Client; bucket: string } {
  const cfg = env.s3;
  if (cfg === null) {
    throw new UpstreamError("S3_NOT_CONFIGURED", "S3 storage is not configured.");
  }
  cachedClient ??= new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return { client: cachedClient, bucket: cfg.bucket };
}

export class S3Storage implements BlobStorage {
  async upload(key: string, data: Buffer, meta: BlobMeta): Promise<void> {
    const { client, bucket } = s3ctx();
    const startedAt = Date.now();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: data,
          ContentType: meta.contentType,
          ...(meta.contentLength !== undefined && { ContentLength: meta.contentLength }),
        }),
      );
      log.debug("s3", "upload ok", { key, bytes: data.length, durationMs: Date.now() - startedAt });
    } catch (err) {
      throw new UpstreamError("S3_UPLOAD_FAILED", `S3 upload failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    const { client, bucket } = s3ctx();
    const startedAt = Date.now();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) {
        throw new UpstreamError("S3_DOWNLOAD_FAILED", `S3 object "${key}" returned no body.`);
      }
      const bytes = await res.Body.transformToByteArray();
      log.debug("s3", "download ok", {
        key,
        bytes: bytes.length,
        durationMs: Date.now() - startedAt,
      });
      return {
        data: Buffer.from(bytes),
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw new UpstreamError("S3_DOWNLOAD_FAILED", `S3 download failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async signedGetUrl(
    key: string,
    ttlSeconds = 900,
    opts?: SignedGetOptions,
  ): Promise<string | null> {
    const { client, bucket } = s3ctx();
    try {
      return await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(opts?.downloadFilename !== undefined
            ? { ResponseContentDisposition: `attachment; filename="${opts.downloadFilename}"` }
            : {}),
        }),
        { expiresIn: ttlSeconds },
      );
    } catch (err) {
      throw new UpstreamError("S3_SIGN_FAILED", `Could not sign a URL for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async createPresignedUpload(key: string, contentType: string): Promise<PresignedUpload | null> {
    const { client, bucket } = s3ctx();
    try {
      const { url, fields } = await createPresignedPost(client, {
        Bucket: bucket,
        Key: key,
        // POST Policy restores the size + content-type validation we'd lose by bypassing multer.
        Conditions: [["content-length-range", 1, MAX_MEDIA_BYTES]],
        Fields: { "Content-Type": contentType },
        Expires: 300,
      });
      return { url, fields, key };
    } catch (err) {
      throw new UpstreamError("S3_PRESIGN_FAILED", `Could not presign an upload for "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = s3ctx();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      throw new UpstreamError("S3_DELETE_FAILED", `S3 delete failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
