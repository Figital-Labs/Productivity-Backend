/**
 * `GcsStorage` — the concrete `BlobStorage` over Google Cloud Storage (ADR-0023, ported from S3).
 * Wraps the official client so call sites depend on our interface, not the vendor SDK.
 * Auth is Application Default Credentials (Cloud Run / VM service account) — no key files.
 * Failures become `UpstreamError` (→ 502) so they flow through the central error
 * middleware exactly like other downstream failures (e.g. Vertex).
 */
import { Storage } from "@google-cloud/storage";

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

// Lazily build the client + read the bucket on first use: this file is statically imported
// under the disk driver too, where `env.gcs` is null.
let cachedClient: Storage | null = null;
function gcsctx(): { client: Storage; bucket: string } {
  const cfg = env.gcs;
  if (cfg === null) {
    throw new UpstreamError("GCS_NOT_CONFIGURED", "GCS storage is not configured.");
  }
  cachedClient ??= new Storage();
  return { client: cachedClient, bucket: cfg.bucket };
}

export class GcsStorage implements BlobStorage {
  async upload(key: string, data: Buffer, meta: BlobMeta): Promise<void> {
    const { client, bucket } = gcsctx();
    const startedAt = Date.now();
    try {
      await client
        .bucket(bucket)
        .file(key)
        .save(data, { contentType: meta.contentType, resumable: false });
      log.debug("gcs", "upload ok", {
        key,
        bytes: data.length,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      throw new UpstreamError("GCS_UPLOAD_FAILED", `GCS upload failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    const { client, bucket } = gcsctx();
    const startedAt = Date.now();
    try {
      const file = client.bucket(bucket).file(key);
      const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
      log.debug("gcs", "download ok", {
        key,
        bytes: data.length,
        durationMs: Date.now() - startedAt,
      });
      return { data, contentType: meta.contentType ?? "application/octet-stream" };
    } catch (err) {
      throw new UpstreamError("GCS_DOWNLOAD_FAILED", `GCS download failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async signedGetUrl(
    key: string,
    ttlSeconds = 900,
    opts?: SignedGetOptions,
  ): Promise<string | null> {
    const { client, bucket } = gcsctx();
    try {
      const [url] = await client
        .bucket(bucket)
        .file(key)
        .getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + ttlSeconds * 1000,
          ...(opts?.downloadFilename !== undefined
            ? { responseDisposition: `attachment; filename="${opts.downloadFilename}"` }
            : {}),
        });
      return url;
    } catch (err) {
      throw new UpstreamError("GCS_SIGN_FAILED", `Could not sign a URL for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async createPresignedUpload(key: string, contentType: string): Promise<PresignedUpload | null> {
    const { client, bucket } = gcsctx();
    try {
      const [{ url, fields }] = await client
        .bucket(bucket)
        .file(key)
        .generateSignedPostPolicyV4({
          // Generous (default 900s) so a 10 MB capture finishes even on a slow mobile link.
          expires: Date.now() + env.presignUploadExpirySeconds * 1000,
          // POST Policy restores the size + content-type validation we'd lose by bypassing multer.
          conditions: [["content-length-range", 1, MAX_MEDIA_BYTES]],
          fields: { "Content-Type": contentType },
        });
      return { url, fields, key };
    } catch (err) {
      throw new UpstreamError("GCS_PRESIGN_FAILED", `Could not presign an upload for "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = gcsctx();
    try {
      await client.bucket(bucket).file(key).delete();
    } catch (err) {
      throw new UpstreamError("GCS_DELETE_FAILED", `GCS delete failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
