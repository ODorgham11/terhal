import { prisma } from "../../../platform/db/prisma";
import {
  reminderKinds,
  reminderNotification,
  reminderSchedule,
  reminderStillDue,
  type ReminderKind,
} from "../domain/rules";
import { loadTrip, type Db, type NotifiableTrip } from "./trips";
import { writeNotifications } from "./write";

// Reminders (N4): one NotificationReminder row per trip and kind says when it's due. Every trip event rewrites them
// from the trip as it is, inside the event's transaction; the worker's sweep then moves the queue's delayed jobs to
// match (outbox.ts), and the job checks the row and the trip again before sending, so a job the queue still holds for an
// old time never sends.

export const syncReminders = async (db: Db, trip: NotifiableTrip, now = new Date()) => {
  const existing = await db.notificationReminder.findMany({
    where: { tripId: trip.id },
    select: { id: true, kind: true, dueAt: true },
  });
  for (const kind of reminderKinds) {
    const dueAt = reminderSchedule(kind, trip.facts, now);
    const row = existing.find((reminder) => reminder.kind === kind);
    if (!row) {
      if (dueAt) await db.notificationReminder.create({ data: { tripId: trip.id, kind, dueAt } });
    } else if (row.dueAt?.getTime() !== dueAt?.getTime()) {
      await db.notificationReminder.update({ where: { id: row.id }, data: { dueAt } });
    }
  }
};

// A reminder job woke up. Sends only if its row still says this time and the trip still calls for it, then clears the
// row (whatever happened), so the sweep stops tracking it. Returns the deliveries to queue.
export const fireReminder = async (
  tripId: string,
  kind: ReminderKind,
  dueAt: Date,
  now = new Date(),
): Promise<string[]> =>
  prisma.$transaction(async (tx) => {
    const row = await tx.notificationReminder.findUnique({
      where: { tripId_kind: { tripId, kind } },
      select: { id: true, dueAt: true },
    });
    if (row?.dueAt?.getTime() !== dueAt.getTime()) return [];

    const trip = await loadTrip(tx, tripId);
    const deliveries =
      trip && reminderStillDue(kind, trip.facts, dueAt, now)
        ? await writeNotifications(tx, {
            trip,
            planned: reminderNotification[kind],
            data: trip.data,
            cause: (notice) => `reminder.${notice}.${tripId}.${String(dueAt.getTime())}`,
          })
        : [];
    await tx.notificationReminder.updateMany({
      where: { id: row.id, dueAt },
      data: { dueAt: null, queuedFor: null },
    });
    return deliveries;
  });
