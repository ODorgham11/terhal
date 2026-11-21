import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";

// The same images as infra/docker-compose.yml and production: tests run against real Postgres and Redis, never mocks,
// because the invariants live in the database.
export default async function setup() {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:18-alpine")
      .withDatabase("template_terhal")
      .withUsername("terhal")
      .withPassword("terhal")
      .start(),
    new RedisContainer("redis:8-alpine").start(),
  ]);

  // Uploaded files go to the local driver, in a folder of this run's own.
  const storageDir = await mkdtemp(join(tmpdir(), "terhal-storage-"));

  const template = postgres.getConnectionUri();
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: template, DATABASE_URL_UNPOOLED: template },
    stdio: "pipe",
  });

  // Inherited by every test worker. Set explicitly so a developer's .env can't leak in (dotenv never overrides variables
  // that are already set).
  Object.assign(process.env, {
    TEST_POSTGRES_URL: template,
    // Each worker picks its own logical database from this (test/setup.ts).
    TEST_REDIS_URL: redis.getConnectionUrl(),
    APP_ENV: "development",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    SITE_URL: "https://local.terhal.co:3000",
    DASHBOARD_URL: "https://dashboard.local.terhal.co:3000",
    ADMIN_URL: "https://admin.local.terhal.co:3000",
    CLIENT_IP_HEADER: "",
    TLS_CERT: "",
    TLS_KEY: "",
    RESEND_KEY: "",
    RESEND_EMAIL: "",
    // Fresh secrets every run.
    ADMIN_SECRET: randomBytes(32).toString("base64"),
    STAFF_SECRET: randomBytes(32).toString("base64"),
    CUSTOMER_SECRET: randomBytes(32).toString("base64"),
    TOTP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: storageDir,
    STORAGE_LOCAL_URL: "https://api.local.terhal.co:8080",
    STORAGE_SIGNING_SECRET: randomBytes(32).toString("base64"),
    S3_ENDPOINT: "",
    S3_REGION: "",
    S3_BUCKET: "",
    S3_ACCESS_KEY_ID: "",
    S3_SECRET_ACCESS_KEY: "",
  });

  return async () => {
    await Promise.all([
      postgres.stop(),
      redis.stop(),
      rm(storageDir, { recursive: true, force: true }),
    ]);
  };
}
