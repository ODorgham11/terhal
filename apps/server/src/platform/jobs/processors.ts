import type { Processor } from "bullmq";

import type { JobData, QueueName } from "./queues";
import { logger } from "../logger/logger";

// The platform's own processors. Modules' queues (trips) get theirs from the module, joined in worker.ts, which starts a
// BullMQ Worker for every queue.
export const processors: { [K in Extract<QueueName, "email">]: Processor<JobData[K]> } = {
  email: (job) => {
    // TODO: send through Resend.
    logger.info({ queue: "email", jobId: job.id }, "email job received (not sent yet)");
    return Promise.resolve();
  },
};
