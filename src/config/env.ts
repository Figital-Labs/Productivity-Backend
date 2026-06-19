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
  // --- Object storage. `STORAGE_DRIVER=s3` (prod, default) requires the AWS_* creds and
  // fails fast at boot if any is missing. `STORAGE_DRIVER=disk` (local dev) writes media to
  // a local folder so a dev without AWS creds can still run the full pipeline. ---
  STORAGE_DRIVER: z.enum(["s3", "disk"]).default("s3"),
  AWS_REGION: z.string().min(1).optional(),
  AWS_BUCKET_NAME: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // OPTIONAL top-level S3 folder. Empty (default) for a bucket DEDICATED to this app → keys are
  // surface-first: `<surface>/<org>/<owner>/<uuid>`. Set a value only to share a bucket with
  // other data. Either way the surface segment (meetings/voice/image) is what lifecycle rules target.
  MEDIA_KEY_PREFIX: z.string().default(""),
  // Local folder for STORAGE_DRIVER=disk.
  DISK_STORAGE_DIR: z.string().min(1).default(".media-store"),
  // Max meeting jobs a single worker handles per poll (ADR-0025).
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // Run the pg-boss consumer inside the web process (single-process deploy). Set to "false"
  // to split it out and run `src/worker.ts` as a dedicated process — a config flip, no code change.
  RUN_WORKER_IN_PROCESS: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(z.treeifyError(parsed.error), null, 2));
  process.exit(1);
}

// Resolve S3 config under the s3 driver — all four AWS_* vars required (a clear boot failure,
// not a vague error on the first upload). The disk driver needs none of them. Destructuring +
// the `process.exit` (never) guard narrows the values to `string`, so the object is null-free
// without a non-null assertion.
interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}
let s3Config: S3Config | null = null;
if (parsed.data.STORAGE_DRIVER === "s3") {
  const { AWS_BUCKET_NAME, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = parsed.data;
  if (!AWS_BUCKET_NAME || !AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.error(
      "STORAGE_DRIVER=s3 but one or more AWS_* vars are missing. " +
        "Set them, or use STORAGE_DRIVER=disk for local dev.",
    );
    process.exit(1);
  }
  s3Config = {
    bucket: AWS_BUCKET_NAME,
    region: AWS_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  };
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
  storageDriver: parsed.data.STORAGE_DRIVER,
  // Always present (used to build keys regardless of driver).
  mediaKeyPrefix: parsed.data.MEDIA_KEY_PREFIX,
  diskStorageDir: parsed.data.DISK_STORAGE_DIR,
  // Non-null only under the s3 driver (resolved + validated above).
  s3: s3Config,
  workerConcurrency: parsed.data.WORKER_CONCURRENCY,
  runWorkerInProcess: parsed.data.RUN_WORKER_IN_PROCESS,
} as const;

export type Env = typeof env;
