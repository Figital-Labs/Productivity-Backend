/**
 * `DiskStorage` — a local-filesystem `BlobStorage` for development so a dev without AWS
 * creds can run the full media pipeline (`STORAGE_DRIVER=disk`). Objects are written under
 * `DISK_STORAGE_DIR`, mirroring the key path; the content type is kept in a tiny sidecar so
 * `download` returns the right MIME for the Gemini inline call.
 *
 * It cannot mint signed URLs or presigned POSTs (those are S3 features), so `signedGetUrl`
 * and `createPresignedUpload` return `null` — callers then fall back to a byte upload through
 * the backend (which lands here), exactly like the production CORS-not-set fallback path.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { env } from "../../config/env.js";
import { UpstreamError } from "../errors.js";

import type { BlobMeta, BlobStorage, PresignedUpload } from "./index.js";

const ROOT = resolve(process.cwd(), env.diskStorageDir);

/** Resolve a key to an absolute path, refusing anything that escapes the storage root. */
function pathForKey(key: string): string {
  const full = resolve(ROOT, key);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    throw new UpstreamError(
      "DISK_BAD_KEY",
      `Refusing to access key outside storage root: "${key}".`,
    );
  }
  return full;
}

export class DiskStorage implements BlobStorage {
  async upload(key: string, data: Buffer, meta: BlobMeta): Promise<void> {
    const file = pathForKey(key);
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, data);
      await writeFile(`${file}.ct`, meta.contentType, "utf8");
    } catch (err) {
      throw new UpstreamError("DISK_UPLOAD_FAILED", `Disk write failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async download(key: string): Promise<{ data: Buffer; contentType: string }> {
    const file = pathForKey(key);
    try {
      const data = await readFile(file);
      const contentType = await readFile(`${file}.ct`, "utf8").catch(
        () => "application/octet-stream",
      );
      return { data, contentType };
    } catch (err) {
      throw new UpstreamError("DISK_DOWNLOAD_FAILED", `Disk read failed for key "${key}".`, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Disk can't mint signed/presigned URLs — callers fall back to byte upload through the API.
  // (A no-arg implementation still satisfies the wider interface signature.)
  signedGetUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }

  createPresignedUpload(): Promise<PresignedUpload | null> {
    return Promise.resolve(null);
  }

  async delete(key: string): Promise<void> {
    const file = pathForKey(key);
    await rm(file, { force: true });
    await rm(`${file}.ct`, { force: true });
  }
}
