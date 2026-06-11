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
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(JSON.stringify(z.treeifyError(parsed.error), null, 2));
  process.exit(1);
}

export const env = {
  databaseUrl: parsed.data.DATABASE_URL,
  port: parsed.data.PORT,
  nodeEnv: parsed.data.NODE_ENV,
  corsOrigins: parsed.data.CORS_ORIGINS,
  jwtSecret: parsed.data.JWT_SECRET,
  jwtTtl: parsed.data.JWT_TTL,
  gcp: {
    credentials: parsed.data.GOOGLE_SERVICE_ACCOUNT_JSON,
    project: parsed.data.GOOGLE_CLOUD_PROJECT,
    location: parsed.data.GOOGLE_CLOUD_LOCATION,
  },
} as const;

export type Env = typeof env;
