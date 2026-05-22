import multer from "multer";

import { ValidationError } from "../lib/errors.js";

interface UploadOptions {
  allowedMimeTypes: readonly string[];
  maxFileSizeBytes: number;
}

function createUpload(opts: UploadOptions): multer.Multer {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: opts.maxFileSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (opts.allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(
        new ValidationError(
          `Unsupported file type "${file.mimetype}". Allowed: ${opts.allowedMimeTypes.join(", ")}`,
        ),
      );
    },
  });
}

const AUDIO_MIME_TYPES = [
  "audio/webm",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
] as const;

const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

const TWENTY_FIVE_MB = 25 * 1024 * 1024;
const FIFTEEN_MB = 15 * 1024 * 1024;

export const voiceUpload = createUpload({
  allowedMimeTypes: AUDIO_MIME_TYPES,
  maxFileSizeBytes: TWENTY_FIVE_MB,
});

export const imageUpload = createUpload({
  allowedMimeTypes: IMAGE_MIME_TYPES,
  maxFileSizeBytes: FIFTEEN_MB,
});
