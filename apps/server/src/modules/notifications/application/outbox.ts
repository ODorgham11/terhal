import type { JobsOptions } from "bullmq";
import { prisma } from "../../../platform/db/prisma";
import { queues } from "../../../platform/jobs/queues";
import { logger } from "../../../platform/logger/logger";
import type { ReminderKind } from "../domain/rules";

// The outbox (N4). Notifications are written in the transaction of the change that caused them, but a job can only be
// queued once that transaction has committed, and a process can die in between. So the rows are the outbox: a scheduled
// sweep queues every pending delivery not yet queued and moves reminder jobs to match their rows. Job ids are
// deterministic, so queueing twice (two sweeps, a crash before the row was marked) adds nothing.

const MINUTE = 60_000;

// The job gate's signal for the sweep: notifyTripEvent marks it when it writes to the outbox (platform/jobs/gate.ts).
export const OUTBOX_SIGNAL = "notifications.outbox";

// Retries with backoff: 30 s, 1, 2, 4 and 8 minutes. Finished jobs are kept a day (failed ones a week), so a repeated
// id is still recognised.
export const jobOptions: JobsOptions = {
  attempts: 6,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 24 * 60 * MINUTE },
  removeOnFail: { age: 7 * 24 * 60 * MINUTE },
};

// BullMQ ids can't contain ":".
export const deliveryJobId = (deliveryId: string) => `delivery.${deliveryId}`;
export const reminderJobId = (tripId: string, kind: ReminderKind, dueAt: Date) =>
  `reminder.${kind}.${tripId}.${String(dueAt.getTime())}`;

// A pending delivery queued this long ago and still pending lost its job (Redis was emptied): queue it again. Longer
// than the retries take.
const STALE_DELIVERY = 30 * MINUTE;
// A reminder whose job should have run this long ago but whose row it never cleared.
const STALE_REMINDER = 2 * MINUTE;
const BATCH = 200;

export const queueDeliveries = async (ids: string[], now = new Date()) => {
  if (ids.length === 0) return;
  await queues.notifications.addBulk(
    ids.map((deliveryId) => ({
      name: "deliver",
      data: { deliveryId },
      opts: { ...jobOptions, jobId: deliveryJobId(deliveryId) },
    })),
  );
  await prisma.notificationDelivery.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { queuedAt: now },
  });
};

const sweepDeliveries = async (now: Date) => {
  const due = await prisma.notificationDelivery.findMany({
    where: {
      status: "PENDING",
      OR: [{ queuedAt: null }, { queuedAt: { lt: new Date(now.getTime() - STALE_DELIVERY) } }],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: { id: true },
  });
  await queueDeliveries(
    due.map((row) => row.id),
    now,
  );
  return due.length;
};

interface ReminderRow {
  id: string;
  tripId: string;
  kind: ReminderKind;
  dueAt: Date | null;
  queuedFor: Date | null;
}

const sweepReminders = async (now: Date) => {
  const rows = await prisma.$queryRaw<ReminderRow[]>`
    SELECT "id", "tripId", "kind"::text AS "kind", "dueAt", "queuedFor"
    FROM "NotificationReminder"
    WHERE ("dueAt" IS DISTINCT FROM "queuedFor" OR "queuedFor" IS NOT NULL)
      AND ("dueAt" IS DISTINCT FROM "queuedFor" OR "queuedFor" < ${new Date(now.getTime() - STALE_REMINDER)})
    ORDER BY "updatedAt"
    LIMIT ${BATCH}`;

  for (const row of rows) {
    // The old job, if it's for another time. One already running can't be removed; it finds its row moved and sends
    // nothing.
    if (row.queuedFor && row.queuedFor.getTime() !== row.dueAt?.getTime()) {
      await queues.notifications
        .remove(reminderJobId(row.tripId, row.kind, row.queuedFor))
        .catch((error: unknown) => {
          logger.warn({ err: error, reminderId: row.id }, "couldn't remove a reminder job");
        });
    }
    if (row.dueAt) {
      await queues.notifications.add(
        "remind",
        { tripId: row.tripId, kind: row.kind, dueAt: row.dueAt.toISOString() },
        {
          ...jobOptions,
          jobId: reminderJobId(row.tripId, row.kind, row.dueAt),
          delay: Math.max(0, row.dueAt.getTime() - now.getTime()),
        },
      );
    }
    // Only if the row wasn't moved meanwhile; a moved one is picked up by the next sweep.
    await prisma.notificationReminder.updateMany({
      where: { id: row.id, dueAt: row.dueAt },
      data: { queuedFor: row.dueAt },
    });
  }
  return rows.length;
};

export const sweepOutbox = async (now = new Date()) => {
  const deliveries = await sweepDeliveries(now);
  const reminders = await sweepReminders(now);
  if (deliveries + reminders > 0) {
    logger.info(
      { job: "sweep-notifications", deliveries, reminders },
      "swept the notifications outbox",
    );
  }
  return { deliveries, reminders };
};
