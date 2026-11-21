import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Same files as src/shared/utils/env.ts: local Postgres from apps/server/.env, a Neon branch from the repo-root .env.local.
config({ path: [".env", "../../.env.local"] });

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct connection; the pooled DATABASE_URL is for the app at runtime.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  },
});
