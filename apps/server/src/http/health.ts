import { Hono } from "hono";
import { prisma } from "../platform/db/prisma";
import { isShuttingDown } from "../platform/lifecycle/state";
import { cache } from "../platform/redis/connections";

const CHECK_TIMEOUT_MS = 2_000;

const reachable = async (probe: () => Promise<unknown>): Promise<boolean> => {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("health check timed out"));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([probe(), timedOut]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const health = new Hono()
  // Is the process up? Checks nothing else: a database blip must not cause a restart loop.
  .get("/live", (c) => c.json({ status: "ok" }))
  // Can this instance serve requests? Checked once per deploy (.github/workflows/deploy.yml). Postgres is required; Redis
  // is reported. Without it sign in fails closed (the rate limiter can't count), so it's "degraded", not down.
  .get("/ready", async (c) => {
    if (isShuttingDown()) return c.json({ status: "shutting_down" }, 503);

    const database = await reachable(() => prisma.$queryRaw`SELECT 1`);
    // The connection's own state, not a PING: commands to a down Redis queue up instead of failing.
    const redis = cache.status === "ready";

    const checks = { database: database ? "ok" : "down", cache: redis ? "ok" : "down" };
    if (!database) return c.json({ status: "unavailable", checks }, 503);
    return c.json({ status: redis ? "ok" : "degraded", checks });
  });
