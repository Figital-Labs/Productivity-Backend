/**
 * Object-storage seam (ADR-0023). All media (audio/images) flows through this
 * `BlobStorage` interface so the backend never hard-codes a cloud vendor. Two
 * implementations: `S3Storage` (prod) and `DiskStorage` (local dev, no AWS creds) —
 * selected by `STORAGE_DRIVER`. A future GCS/R2 swap is one more file (Strategy + Adapter).
 *
 * `storage` is a process-wide singleton (same discipline as `prisma` and the Vertex
 * client): one client reused across every request and the in-process worker.
 *
 * Direct-to-S3 upload + signed read are first-class here so the web process never has to
 * shovel audio bytes: the browser presigns → uploads to storage → sends the key; the worker
 * `download`s the key to inline to Gemini (which can't read `s3://`). `createPresignedUpload`
 * returns `null` when the driver can't presign (disk) — callers then fall back to a byte
 * upload through the backend, so direct upload is a progressive enhancement, never required.
 */
import { env } from "../../config/env.js";

import { DiskStorage } from "./disk.js";
import { S3Storage } from "./s3.js";

export interface BlobMeta {
  contentType: string;
  /** Byte length when known, so the store can validate the object. */
  contentLength?: number;
}

export interface PresignedUpload {
  /** The URL the browser POSTs the multipart form to. */
  url: string;
  /** Form fields that must be appended before the file (policy, signature, key, …). */
  fields: Record<string, string>;
  /** The object key the upload will land at — sent back to the API after upload. */
  key: string;
}

export interface SignedGetOptions {
  /** When set, the link forces a download (Content-Disposition: attachment) vs streaming. */
  downloadFilename?: string;
}

export interface BlobStorage {
  /** Store `data` under `key` (overwrites if the key already exists). */
  upload(key: string, data: Buffer, meta: BlobMeta): Promise<void>;
  /** Read the object back into memory — used by the worker before a Vertex call. */
  download(key: string): Promise<{ data: Buffer; contentType: string }>;
  /** Short-lived GET URL to listen to / download a stored object; `null` if unsupported. */
  signedGetUrl(key: string, ttlSeconds?: number, opts?: SignedGetOptions): Promise<string | null>;
  /** Presigned POST so the browser uploads straight to storage; `null` ⇒ use byte fallback. */
  createPresignedUpload(key: string, contentType: string): Promise<PresignedUpload | null>;
  /** Delete a single object — for clips the user discards after uploading. */
  delete(key: string): Promise<void>;
}

/** Largest object the presigned POST policy will accept (per clip). */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export const storage: BlobStorage =
  env.storageDriver === "s3" ? new S3Storage() : new DiskStorage();
