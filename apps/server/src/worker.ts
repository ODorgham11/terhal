import { Worker, type Processor } from "bullmq";
import { notificationJobs, processNotificationJob } from "./modules/notifications/index";
import { processTripJob, tripJobs } from "./modules/trips/index";
import { processors } from "./platform/jobs/processors";
import { queues, type JobData, type QueueName } from "./platform/jobs/queues";
import { handleShutdown } from "./platform/lifecycle/shutdown";
import { logger } from "./platform/logger/logger";
import { createQueueConnection } from "./platform/redis/connections";

// The worker entry point, the worker container in deploy/compose.yml. No HTTP: it only pulls jobs off the queue Redis.
// One processor per queue.
const all: { [K in QueueName]: Processor<JobData[K]> } = {
  ...processors,
  trips: processTripJob,
  notifications: processNotificationJob,
};

// Each queue's payload type is checked above; the Worker itself takes any.
const workers = (Object.entries(all) as [QueueName, Processor][]).map(([name, processor]) => {
  const worker = new Worker(name, processor, { connection: createQueueConnection() });

  worker.on("failed", (job, err) => {
    logger.error({ err, queue: name, jobId: job?.id }, "job failed");
  });

  return worker;
});

// Repeatable jobs. The scheduler id is the job's name, so every start replaces the schedule instead of adding one.
await Promise.all([
  ...Object.entries(tripJobs).map(([name, { every }]) =>
    queues.trips.upsertJobScheduler(name, { every }, { name, data: {} }),
  ),
  ...Object.entries(notificationJobs).map(([name, { every }]) =>
    queues.notifications.upsertJobScheduler(name, { every }, { name, data: {} }),
  ),
]);

logger.info({ queues: workers.map((w) => w.name) }, "worker started");

// close() stops fetching new jobs and waits for the running ones. A job cut off by the deadline is retried by BullMQ, so
// every job must be idempotent. 55 seconds, inside the container's 60-second stop_grace_period.
handleShutdown(async () => {
  await Promise.all(workers.map((w) => w.close()));
}, 55_000);
