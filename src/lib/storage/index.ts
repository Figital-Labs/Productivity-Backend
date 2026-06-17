/**
 * Object-storage seam (ADR-0023). All media (audio/images) flows through this
 * `BlobStorage` interface so the backend never hard-codes a cloud vendor — today the only
 * implementation is `S3Storage`, and a future GCS/R2 swap touches a single file
 * (Strategy + Adapter pattern; see ADR-0023, and ADR-0026 for the GCS reconsideration).
 *
 * `storage` is a process-wide singleton (same discipline as `prisma` and the Vertex
 * client): one S3 client reused across every request and the worker.
 *
 * The interface grows per phase — only methods with a live caller exist. Phase 0/1 needs
 * `upload` (controller persists the bytes) + `download` (the async worker re-reads them
 * for the Vertex call). `signedGetUrl`/`signedPutUrl`/`delete` arrive with Phases 2–5.
 */
import { S3Storage } from "./s3.js";

export interface BlobMeta {
  contentType: string;
  /** Byte length when known, so S3 can validate the stored object. */
  contentLength?: number;
}

export interface BlobStorage {
  /** Store `data` under `key` (overwrites if the key already exists). */
  upload(key: string, data: Buffer, meta: BlobMeta): Promise<void>;
  /** Read the object back into memory — used by the worker before a Vertex call. */
  download(key: string): Promise<{ data: Buffer; contentType: string }>;
}

export const storage: BlobStorage = new S3Storage();
