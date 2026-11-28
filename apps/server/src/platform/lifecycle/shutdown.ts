import type { Redis } from "ioredis";
import { prisma } from "../db/prisma";
import { logger } from "../logger/logger";
import { cache, signals } from "../redis/connections";
import { isShuttingDown, markShuttingDown } from "./state";

const closeRedis = async (client: Redis) => {
  // quit() waits for pending replies; a client that never connected or is reconnecting has none.
  if (client.status === "ready") await client.quit();
  else client.disconnect();
};

// Shuts the process down in order: stop taking new work, let in-flight work finish, then close the connections that
// work was using. Docker sends SIGKILL after the container's stop_grace_period (deploy/compose.yml), so `graceMs` must
// be shorter: past it, give up and exit non-zero so it shows in the logs.
export const handleShutdown = (stopIntake: () => Promise<void>, graceMs: number) => {
  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown()) return;
    markShuttingDown();
    logger.info({ signal }, "shutting down");

    setTimeout(() => {
      logger.error({ graceMs }, "shutdown timed out");
      process.exit(1);
    }, graceMs).unref();

    try {
      await stopIntake();
      await Promise.all([prisma.$disconnect(), closeRedis(cache), closeRedis(signals)]);
      logger.info("shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGTERM", (signal) => void shutdown(signal));
  process.on("SIGINT", (signal) => void shutdown(signal));

  // The process is in an unknown state: log it in our format and let Docker restart it.
  const crash = (err: unknown) => {
    logger.fatal({ err }, "crashed");
    process.exit(1);
  };
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);
};
