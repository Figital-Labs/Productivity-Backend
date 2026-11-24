import { config as loadEnv } from "dotenv";
import { z } from "zod";

// `override: true` so values in `.env` win over any stale variable already present in
// the shell/system environment (dotenv does NOT override by default — that footgun once
// left the app pointed at a dead localhost DB while `.env` had the right Neon URL).
loadEnv({ override: true });

const ServiceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string(),
  private_key_id: z.string(),
  private_key: z.string(),
  client_email: z.string(),
  client_id: z.string(),
  auth_uri: z.string(),
  token_uri: z.string(),
  auth_provider_x509_cert_url: z.string(),
  client_x509_cert_url: z.string(),
  universe_domain: z.string(),
});

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // pg-boss needs a session-mode (direct/unpooled) connection: its LISTEN/NOTIFY +
  // advisory locks break under a transaction pooler (e.g. Neon's `-pooler` endpoint).
  // Falls back to DATABASE_URL for local/non-pooled Postgres; the queue guards against
  // a `-pooler` URL at boot (see jobs/queue.ts).
  DIRECT_DATABASE_URL: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z
    .string()
    .min(1)
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON",
        });
        return z.NEVER;
      }
    })
    .pipe(ServiceAccountSchema),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().min(1),
  // --- Gemini model selection. `gemini-2.5-flash` retires on Vertex AI (Oct 2026), so the
  // model is env-driven: one global default plus per-surface overrides, letting us canary a
  // new model on ONE surface and roll back without a deploy. See .env.example. ---
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  GEMINI_MODEL_EXTRACTION: z.string().min(1).optional(),
  GEMINI_MODEL_DELEGATION: z.string().min(1).optional(),
  GEMINI_MODEL_MEETING: z.string().min(1).optional(),
  GEMINI_MODEL_DAY_CLOSURE: z.string().min(1).optional(),
  GEMINI_MODEL_MORNING_BRIEF: z.string().min(1).optional(),
  GEMINI_MODEL_TRANSCRIBE: z.string().min(1).optional(),
  // Gemini 3 defaults temperature to 1.0 and Google advises AGAINST lowering it (low values can
  // cause looping / degraded output). `configured` keeps our per-surface values (correct for 2.5,
  // where determinism is the point); `model-default` omits temperature entirely so a Gemini 3
  // model runs as Google intends. Flip per environment while evaluating.
  AI_TEMPERATURE_MODE: z.enum(["configured", "model-default"]).default("configured"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Minimum log level. Default `info` keeps routine GET access logs (debug) quiet; set `debug`
  // for the firehose (per-request GETs, S3 op traces, AI request payload shapes).
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  JWT_SECRET: z.string().min(32),
  JWT_TTL: z.string().min(1).default("30d"),
  // --- Object storage. `STORAGE_DRIVER=gcs` (prod, default) requires AWS_BUCKET_NAME (the GCS bucket;
  // name kept from the S3 era) and authenticates with Application Default Credentials — fails fast
  // at boot if the bucket is missing. `s3` is accepted as a legacy alias of `gcs` so an old env
  // keeps booting. `STORAGE_DRIVER=disk` (local dev) writes media to a local folder. ---
  STORAGE_DRIVER: z
    .enum(["gcs", "s3", "disk"])
    .default("gcs")
    .transform((d) => (d === "s3" ? "gcs" : d)),
  AWS_BUCKET_NAME: z.string().min(1).optional(),
  // OPTIONAL top-level bucket folder. Empty (default) for a bucket DEDICATED to this app → keys are
  // surface-first: `<surface>/<org>/<owner>/<uuid>`. Set a value only to share a bucket with
  // other data. Either way the surface segment (meetings/voice/image) is what lifecycle rules target.
  MEDIA_KEY_PREFIX: z.string().default(""),
  // Local folder for STORAGE_DRIVER=disk.
  DISK_STORAGE_DIR: z.string().min(1).default(".media-store"),
  // Per-poll batch sizes, split by queue (ADR-0025). A single meeting holds ~90 MB (+~120 MB
  // base64) in RAM while it runs, so its concurrency is kept low to bound the OOM blast radius;
  // captures are small (≤10 MB) and stay parallel. Size the worker box for
  // MEETING_WORKER_CONCURRENCY × ~120 MB + headroom. (Replaces the old single WORKER_CONCURRENCY.)
  MEETING_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CAPTURE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // Lifetime of a presigned upload URL. Generous so a 10 MB capture finishes even on a slow mobile
  // link (a 5-min window could expire mid-upload on 2G/3G). Single-use + key-scoped → longer is safe.
  PRESIGN_UPLOAD_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),
  // Per-attempt AI timeout (ms) for the async MEETING worker. We support the p95 long meeting
  // (~5–6 hr / 90 MB), so this is sized for that worst case. The pg-boss visibility window AND the
  // frontend poll patience both derive from it (lib/ai-config.jobBudgetSeconds) — one knob, no drift.
  MEETING_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(800_000),
  // pg-boss re-dispatches a job whose WORKER DIED (crash/OOM) up to this many times — a fresh
  // execution per retry. Safe because the visibility window covers a full execution.
  JOB_RETRY_LIMIT: z.coerce.number().int().nonnegative().default(2),
  // Run the pg-boss consumer inside the web process (single-process deploy). Set to "false"
  // to split it out and run `src/worker.ts` as a dedicated process — a config flip, no code change.
  RUN_WORKER_IN_PROCESS: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  // Day-timeline overlap policy. `prevent` (default) cascades colliding tasks so only one
  // runs at a time; `allow` permits concurrent tasks (rendered side-by-side). One flip
  // switches the whole product; resolved centrally in scheduling.service (per-org later).
  OVERLAP_POLICY: z.enum(["prevent", "allow"]).default("prevent"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(z.treeifyError(parsed.error), null, 2));
  process.exit(1);
}

// Resolve GCS config under the gcs driver — a clear boot failure, not a vague error on the first
// upload. The disk driver needs none of it.
interface GcsConfig {
  bucket: string;
}
let gcsConfig: GcsConfig | null = null;
if (parsed.data.STORAGE_DRIVER === "gcs") {
  const { AWS_BUCKET_NAME } = parsed.data;
  if (!AWS_BUCKET_NAME) {
    console.error(
      "STORAGE_DRIVER=gcs but AWS_BUCKET_NAME is missing. " +
        "Set it, or use STORAGE_DRIVER=disk for local dev.",
    );
    process.exit(1);
  }
  gcsConfig = { bucket: AWS_BUCKET_NAME };
}

export const env = {
  databaseUrl: parsed.data.DATABASE_URL,
  // pg-boss connection: explicit direct/unpooled URL, or DATABASE_URL when none is set.
  directDatabaseUrl: parsed.data.DIRECT_DATABASE_URL ?? parsed.data.DATABASE_URL,
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  logLevel: parsed.data.LOG_LEVEL,
  corsOrigins: parsed.data.CORS_ORIGINS,
  jwtSecret: parsed.data.JWT_SECRET,
  jwtTtl: parsed.data.JWT_TTL,
  gcp: {
    credentials: parsed.data.GOOGLE_SERVICE_ACCOUNT_JSON,
    project: parsed.data.GOOGLE_CLOUD_PROJECT,
    location: parsed.data.GOOGLE_CLOUD_LOCATION,
  },
  gemini: {
    model: parsed.data.GEMINI_MODEL,
    // Per-surface overrides; `undefined` falls back to `model` (see ai-config.modelFor).
    perSurface: {
      extraction: parsed.data.GEMINI_MODEL_EXTRACTION,
      delegation: parsed.data.GEMINI_MODEL_DELEGATION,
      meeting: parsed.data.GEMINI_MODEL_MEETING,
      dayClosure: parsed.data.GEMINI_MODEL_DAY_CLOSURE,
      morningBrief: parsed.data.GEMINI_MODEL_MORNING_BRIEF,
      transcribe: parsed.data.GEMINI_MODEL_TRANSCRIBE,
    },
    temperatureMode: parsed.data.AI_TEMPERATURE_MODE,
  },
  storageDriver: parsed.data.STORAGE_DRIVER,
  // Always present (used to build keys regardless of driver).
  mediaKeyPrefix: parsed.data.MEDIA_KEY_PREFIX,
  diskStorageDir: parsed.data.DISK_STORAGE_DIR,
  // Non-null only under the gcs driver (resolved + validated above).
  gcs: gcsConfig,
  meetingWorkerConcurrency: parsed.data.MEETING_WORKER_CONCURRENCY,
  captureWorkerConcurrency: parsed.data.CAPTURE_WORKER_CONCURRENCY,
  presignUploadExpirySeconds: parsed.data.PRESIGN_UPLOAD_EXPIRY_SECONDS,
  meetingAiTimeoutMs: parsed.data.MEETING_AI_TIMEOUT_MS,
  jobRetryLimit: parsed.data.JOB_RETRY_LIMIT,
  runWorkerInProcess: parsed.data.RUN_WORKER_IN_PROCESS,
  overlapPolicy: parsed.data.OVERLAP_POLICY,
} as const;

export type Env = typeof env;
