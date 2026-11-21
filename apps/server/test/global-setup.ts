import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  });

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
