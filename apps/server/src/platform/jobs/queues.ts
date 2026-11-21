import { Queue } from "bullmq";

import { createQueueConnection } from "../redis/connections";

// Each queue's job payload, keyed by queue name. Producers (the server) and processors (the worker) both type off this.
export interface JobData {
  email: { to: string; subject: string; html: string };
  // The trips module's scheduled jobs (expire-pending-trips, advance-overdue-trips), told apart by the job's name.
  trips: Record<string, never>;
  // The analytics module's monthly report (monthly-report).
  analytics: Record<string, never>;
}

export type QueueName = keyof JobData;

const connection = createQueueConnection();

export const queues = {
  email: new Queue<JobData["email"]>("email", { connection }),
  trips: new Queue<JobData["trips"]>("trips", { connection }),
  analytics: new Queue<JobData["analytics"]>("analytics", { connection }),
} satisfies { [K in QueueName]: Queue<JobData[K]> };
