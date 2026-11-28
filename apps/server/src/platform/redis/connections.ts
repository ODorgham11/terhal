import { env } from "../config/env";
import { Redis, type RedisOptions } from "ioredis";

// The cache may evict keys (allkeys-lru), the queue must never evict (noeviction). They're separate instances, locally
// (infra/docker-compose.yml) and on the VPS (deploy/compose.yml).
const cacheUrl = env.CACHE_URL;
const queueUrl = env.QUEUE_URL;

// ioredis defaults to IPv4 only. family: 0 lets it resolve either, whatever the host's private network uses.
const baseOptions: RedisOptions = { family: 0 };

export const cache = new Redis(cacheUrl, baseOptions);

// BullMQ needs maxRetriesPerRequest: null so blocking commands wait for Redis instead of failing mid-job.
// Each Queue/Worker gets its own connection from here, since workers hold a blocking connection open.
export const createQueueConnection = () =>
  new Redis(queueUrl, { ...baseOptions, maxRetriesPerRequest: null });

// The job gate's timestamps (platform/jobs/gate.ts), on the queue instance so they're never evicted. One retry, not
// BullMQ's wait-forever: they're written inside trip transactions, which must not hang on a down Redis.
export const signals = new Redis(queueUrl, { ...baseOptions, maxRetriesPerRequest: 1 });
