import type { TripEventAction } from "@terhal/contracts";
import { markChanged } from "../../../platform/jobs/gate";
import { planNotifications, type EventActor } from "../domain/rules";
import { OUTBOX_SIGNAL } from "./outbox";
import { syncReminders } from "./reminders";
import { loadTrip, type Db } from "./trips";
import { writeNotifications } from "./write";

// The trips module's afterTripEvent hook lands here, inside the transaction that recorded the event. Everything is
// written as rows in that transaction (the notifications, their pending email deliveries, the trip's reminders), and
// nothing is queued from here: the worker's outbox sweep queues them once they're committed, so a rolled back change
// never emails anyone and a committed one is never lost to a crash between the commit and the queue. It marks the outbox
// as changed, so the sweep looks at Postgres again (platform/jobs/gate.ts).

// A recorded trip event, as trips hands it over.
export interface TripEventNotice {
  id: string;
  tripId: string;
  action: TripEventAction;
  actor: EventActor;
  data?: Record<string, unknown> | null;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

export const notifyTripEvent = async (db: Db, event: TripEventNotice, now = new Date()) => {
  await markChanged(OUTBOX_SIGNAL);
  const trip = await loadTrip(db, event.tripId);
  if (!trip) return;

  const planned = planNotifications(event, trip.facts);
  if (planned.booker || planned.staff) {
    await writeNotifications(db, {
      trip,
      planned,
      data: { ...trip.data, reason: text(event.data?.reason), note: text(event.data?.note) },
      // Completing a trip again after a reopen (T8 a) doesn't thank the booker twice.
      cause: (kind) =>
        kind === "TRIP_COMPLETED" ? `trip.${trip.id}.completed` : `event.${event.id}`,
      exceptStaffId: "staffId" in event.actor ? event.actor.staffId : null,
    });
  }
  await syncReminders(db, trip, now);
};
