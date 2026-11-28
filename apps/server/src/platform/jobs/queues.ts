import { Queue } from "bullmq";

import { createQueueConnection } from "../redis/connections";

// Each queue's job payload, keyed by queue name. Producers (the server) and processors (the worker) both type off this.
export interface JobData {
  email: { to: string; subject: string; html: string };
  // The trips module's scheduled jobs (expire-pending-trips, advance-overdue-trips), told apart by the job's name.
  trips: Record<string, never>;
  // The fleet module's scheduled jobs (sweep-uploads).
  fleet: Record<string, never>;
  // The analytics module's monthly report (monthly-report).
  analytics: Record<string, never>;
  // The notifications module's jobs, told apart by the job's name: `deliver` sends one delivery row, `remind` checks a
  // trip's reminder when it's due, and the scheduled `sweep-notifications` queues what the outbox holds.
  notifications:
    | { deliveryId: string }
    | { tripId: string; kind: string; dueAt: string }
    | Record<string, never>;
}

export type QueueName = keyof JobData;

const connection = createQueueConnection();

export const queues = {
  email: new Queue<JobData["email"]>("email", { connection }),
  trips: new Queue<JobData["trips"]>("trips", { connection }),
  fleet: new Queue<JobData["fleet"]>("fleet", { connection }),
  analytics: new Queue<JobData["analytics"]>("analytics", { connection }),
  notifications: new Queue<JobData["notifications"]>("notifications", { connection }),
} satisfies { [K in QueueName]: Queue<JobData[K]> };
