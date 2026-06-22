import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod/v4";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");

dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

const nodeEnvSchema = z.enum(["development", "test", "production"]);

const rawNodeEnv = nodeEnvSchema.catch("development").parse(process.env.NODE_ENV);

if (rawNodeEnv === "production" && !process.env.CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN is required when NODE_ENV=production");
}

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
  DATABASE_URL: z.url(),
  TEST_DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DASHBOARD_PORT: z.coerce.number().int().positive().max(65535).default(5173),
  CORS_ORIGIN: z.url().optional(),
  DSN_HOST: z.string().min(1).optional(),
  DSN_SCHEME: z.enum(["http", "https"]).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.email().default("no-reply@mini-sentry.local"),
  // ── Retention / pruning (P0) ──────────────────────────────────────────────
  // 주기 정리 잡 활성 여부. 대상별 보존기간(일). 0이면 해당 대상은 정리하지 않음.
  RETENTION_ENABLED: z.stringbool().default(true),
  RETENTION_REPLAY_DAYS: z.coerce.number().int().min(0).default(14),
  RETENTION_SNAPSHOT_DAYS: z.coerce.number().int().min(0).default(14),
  RETENTION_EVENT_DAYS: z.coerce.number().int().min(0).default(90),
  RETENTION_BATCH_SIZE: z.coerce.number().int().positive().max(100_000).default(1_000),
  // BullMQ repeatable job cron 패턴(기본: 매일 03:00).
  RETENTION_CRON: z.string().min(1).default("0 3 * * *")
});

const parsedEnv = envSchema.parse({
  ...process.env,
  NODE_ENV: rawNodeEnv,
  DATABASE_URL:
    rawNodeEnv === "test" && process.env.TEST_DATABASE_URL
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL
});

export const env = {
  ...parsedEnv,
  CORS_ORIGIN:
    parsedEnv.CORS_ORIGIN ?? `http://localhost:${String(parsedEnv.DASHBOARD_PORT)}`,
  DSN_HOST: parsedEnv.DSN_HOST ?? `localhost:${String(parsedEnv.API_PORT)}`,
  DSN_SCHEME:
    parsedEnv.DSN_SCHEME ?? (parsedEnv.NODE_ENV === "production" ? "https" : "http")
} as const;

export const isProduction = env.NODE_ENV === "production";
