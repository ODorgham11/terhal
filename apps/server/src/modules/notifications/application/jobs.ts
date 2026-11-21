import type { Job } from "bullmq";
import { prisma } from "../../../platform/db/prisma";
import type { JobData } from "../../../platform/jobs/queues";
import { logger } from "../../../platform/logger/logger";
import { reminderKinds, type ReminderKind } from "../domain/rules";
import { deliver } from "./delivery";
import { queueDeliveries, sweepOutbox } from "./outbox";
import { fireReminder } from "./reminders";

// The notifications queue's jobs: `deliver` and `remind` are queued by the outbox sweep, which itself runs on a schedule.

// Every 5 seconds: emails go out within seconds of the change that caused them.
export const notificationJobs = {
  "sweep-notifications": { every: 5_000 },
};

type NotificationJob = Job<JobData["notifications"]>;

const isFinal = (job: NotificationJob) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const remind = async (job: NotificationJob) => {
  const { data } = job;
  if (!("tripId" in data) || !reminderKinds.includes(data.kind as ReminderKind)) {
    throw new Error(`Bad reminder job: ${String(job.id)}`);
  }
  const kind = data.kind as ReminderKind;
  const dueAt = new Date(data.dueAt);
  try {
    // Queued straight away: this transaction has committed. The sweep would find them anyway.
    await queueDeliveries(await fireReminder(data.tripId, kind, dueAt));
  } catch (error) {
    // Out of retries: stop tracking it, so the sweep doesn't queue it again.
    if (isFinal(job)) {
      logger.error({ err: error, tripId: data.tripId, kind }, "gave up on a reminder");
      await prisma.notificationReminder.updateMany({
        where: { tripId: data.tripId, kind, dueAt },
        data: { dueAt: null, queuedFor: null },
      });
    }
    throw error;
  }
};

export const processNotificationJob = async (job: NotificationJob) => {
  switch (job.name) {
    case "deliver":
      if (!("deliveryId" in job.data)) throw new Error(`Bad delivery job: ${String(job.id)}`);
      await deliver(job.data.deliveryId, { final: isFinal(job) });
      return;
    case "remind":
      await remind(job);
      return;
    case "sweep-notifications":
      await sweepOutbox();
      return;
    default:
      throw new Error(`Unknown notifications job: ${job.name}`);
  }
};
