/**
 * `S3Storage` — the concrete `BlobStorage` over AWS S3 (ADR-0023). Wraps the AWS SDK v3
 * client so call sites depend on our interface, not the vendor SDK (Adapter pattern).
 * Failures become `UpstreamError` (→ 502) so they flow through the central error
 * middleware exactly like other downstream failures (e.g. Vertex).
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "../../config/env.js";
import { UpstreamError } from "../errors.js";

import type { BlobMeta, BlobStorage } from "./index.js";

// One client for the process lifetime. Credentials are passed explicitly from the
// validated env (the SDK would also read AWS_* from process.env, but explicit is clearer).
const client = new S3Client({
  region: env.s3.region,
  credentials: {
    accessKeyId: env.s3.accessKeyId,
    secretAccessKey: env.s3.secretAccessKey,
  },
});

export class S3Storage implements BlobStorage {
  async upload(key: string, data: Buffer, meta: BlobMeta): Promise<void> {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: env.s3.bucket,
          Key: key,
          Body: data,
          ContentType: meta.contentType,
          ...(meta.contentLength !== undefined && { ContentLength: meta.contentLength }),
        }),
      );
    } catch (err) {
      throw new UpstreamError("S3_UPLOAD_FAILED", `S3 upload failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }));
      if (!res.Body) {
        throw new UpstreamError("S3_DOWNLOAD_FAILED", `S3 object "${key}" returned no body.`);
      }
      const bytes = await res.Body.transformToByteArray();
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
}
