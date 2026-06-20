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

export const AUDIO_MIME_TYPES = [
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

export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

// Sprint 8 (BUG-009): tightened from 25/15 MB to a unified 10 MB cap for both
// audio and image. Covers ~5 min audio at typical bitrate + standard phone-camera
// JPEGs. Frontend (FE Sprint 08) caps at the same number for symmetric UX.
// MulterError.LIMIT_FILE_SIZE → 413 FILE_TOO_LARGE in src/middleware/error.ts.
export const TEN_MB = 10 * 1024 * 1024;

export const voiceUpload = createUpload({
  allowedMimeTypes: AUDIO_MIME_TYPES,
  maxFileSizeBytes: TEN_MB,
});

export const imageUpload = createUpload({
  allowedMimeTypes: IMAGE_MIME_TYPES,
  maxFileSizeBytes: TEN_MB,
});

// Voice/image capture byte-fallback (ADR-0025): one `file` field that may be audio OR image (the
// `surface` arrives as a sibling form field). Union allow-list; the service validates surface↔type.
// A no-op on the JSON (direct-to-S3 key) path — multer only acts on multipart requests.
export const captureUpload = createUpload({
  allowedMimeTypes: [...AUDIO_MIME_TYPES, ...IMAGE_MIME_TYPES],
  maxFileSizeBytes: TEN_MB,
});

export const multiModalUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TEN_MB },
  fileFilter: (_req, file, cb) => {
    const allowed =
      file.fieldname === "audio"
        ? (AUDIO_MIME_TYPES as readonly string[])
        : (IMAGE_MIME_TYPES as readonly string[]);
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      new ValidationError(
        `Unsupported file type "${file.mimetype}" for field "${file.fieldname}".`,
      ),
    );
  },
}).fields([
  { name: "audio", maxCount: 1 },
  { name: "image", maxCount: 1 },
]);

// Sprint 15: meetings `/process` endpoint accepts multiple audio clips + images
// in one multipart request. Same 10MB per-file cap as everything else; field
// names are `audio` (plural in practice, sent N times) and `images`. Reuses
// the same MIME whitelists; the fileFilter discriminates by fieldname.
const MEETINGS_AUDIO_MAX_COUNT = 12;
const MEETINGS_IMAGES_MAX_COUNT = 4;
export const meetingsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TEN_MB },
  fileFilter: (_req, file, cb) => {
    const allowed =
      file.fieldname === "audio"
        ? (AUDIO_MIME_TYPES as readonly string[])
        : (IMAGE_MIME_TYPES as readonly string[]);
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      new ValidationError(
        `Unsupported file type "${file.mimetype}" for field "${file.fieldname}".`,
      ),
    );
  },
}).fields([
  { name: "audio", maxCount: MEETINGS_AUDIO_MAX_COUNT },
  { name: "images", maxCount: MEETINGS_IMAGES_MAX_COUNT },
]);
