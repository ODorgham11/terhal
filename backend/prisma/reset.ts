// Wipes the local database: drops every table and row, then reapplies all migrations. Run with `npm run db:reset`.
// Refuses to run unless DATABASE_URL points at a local Postgres, so it can never purge a hosted database by accident.
// Prisma asks for confirmation first; pass `-- --force` to skip it.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL isn't set.");

const { hostname } = new URL(url);
if (!LOCAL_HOSTS.has(hostname)) {
    console.error(`Refusing to reset: DATABASE_URL points at "${hostname}", which isn't a local database.`);
    process.exit(1);
}

const result = spawnSync("prisma", ["migrate", "reset", ...process.argv.slice(2)], { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
