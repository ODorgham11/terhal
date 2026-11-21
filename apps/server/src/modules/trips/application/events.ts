import type { TripEventAction, TripStatus } from "@terhal/contracts";
import type { Prisma, Trip } from "../../../../generated/prisma/client";
import type { AppError } from "../../../platform/errors/app-error";
import { afterTripEvent } from "./hooks";
import { jsonValue, lockTrip, statusConflict, tripNotFound, tripWriteError } from "./shared";

// Every change to a trip goes through changeTrip, and every trip event through recordTripEvent, so a trip's history
// (TripEvent) is complete and the hooks see everything.

// The background jobs that change trips, named on their events.
export type SystemJob = "expire-pending-trips" | "advance-overdue-trips";

// Who made a change: exactly one of these (TripEvent_one_actor).
export type TripActor =
  { staffId: string } | { customerId: string } | { guestSessionId: string } | { system: SystemJob };

export type TripEventData = Record<string, Prisma.InputJsonValue | null>;

export interface TripEventInput {
  tripId: string;
  actor: TripActor;
  action: TripEventAction;
  data?: TripEventData;
}

export interface RecordedTripEvent extends TripEventInput {
  id: string;
  createdAt: Date;
}

const actorColumns = (actor: TripActor) => ({
  staffId: "staffId" in actor ? actor.staffId : null,
  customerId: "customerId" in actor ? actor.customerId : null,
  guestSessionId: "guestSessionId" in actor ? actor.guestSessionId : null,
  system: "system" in actor ? actor.system : null,
});

// Writes the event, then runs the hook for it (notifications), inside the caller's transaction.
export const recordTripEvent = async (tx: Prisma.TransactionClient, event: TripEventInput) => {
  const row = await tx.tripEvent.create({
    data: {
      tripId: event.tripId,
      action: event.action,
      ...(event.data && { data: event.data }),
      ...actorColumns(event.actor),
    },
    select: { id: true, createdAt: true },
  });
  const recorded = { ...event, ...row };
  await afterTripEvent(tx, recorded);
  return recorded;
};

// Fields a change can set, with plain values (no Prisma operations), so before and after can be recorded.
export type TripFields = Partial<
  Pick<
    Prisma.TripUncheckedUpdateInput,
    | "status"
    | "priceState"
    | "totalPrice"
    | "clientName"
    | "clientPhone"
    | "classId"
    | "classSnapshot"
    | "car"
    | "passengers"
    | "largeLuggage"
    | "mediumLuggage"
    | "smallLuggage"
    | "pickupDate"
    | "notes"
    | "pickupId"
    | "pickupSnapshot"
    | "pickupSnapshotAr"
    | "pickupLatitude"
    | "pickupLongitude"
    | "dropoffId"
    | "dropoffSnapshot"
    | "dropoffSnapshotAr"
    | "dropoffLatitude"
    | "dropoffLongitude"
    | "driverId"
    | "vehicleId"
    | "officeId"
    | "paymentMethod"
    | "paidAt"
    | "previousTripId"
    | "reportTokenHash"
    | "reportTokenExpiresAt"
  >
>;

// Never written to an event: secrets.
const UNRECORDED = new Set(["reportTokenHash", "reportTokenExpiresAt"]);

export interface TripChange {
  tripId: string;
  actor: TripActor;
  action: TripEventAction;
  // The statuses the trip must be in. The change is a conditional update on the status it was found in, under a lock.
  from?: readonly TripStatus[];
  // What to do when it isn't in one of them; a TRIP_STATUS_CONFLICT by default.
  refuse?: (trip: Trip) => AppError;
  // Further checks on the locked trip before anything is written.
  check?: (trip: Trip) => void | Promise<void>;
  set: TripFields | ((trip: Trip) => TripFields);
  // Extra event data, e.g. a reason. A function is called after the checks.
  data?: TripEventData | ((trip: Trip) => TripEventData);
  // Record the event even when no field changed (an action that is itself the news, such as an acceptance).
  always?: boolean;
}

const same = (field: string, a: unknown, b: unknown) =>
  JSON.stringify(jsonValue(a, field)) === JSON.stringify(jsonValue(b, field));

// Changes one trip and records the event with what changed, in the caller's transaction:
// - locks the trip and checks it's in an allowed status (two people can't both win a move);
// - updates only on the status it was found in;
// - records `from` and `to` when the status moves, and every other changed field's `before` and `after`.
// Returns the trip as it is afterwards, and whether anything changed.
export const changeTrip = async (tx: Prisma.TransactionClient, change: TripChange) => {
  if (!(await lockTrip(tx, change.tripId))) throw tripNotFound();
  const trip = await tx.trip.findUniqueOrThrow({ where: { id: change.tripId } });
  if (change.from && !change.from.includes(trip.status)) {
    throw change.refuse?.(trip) ?? statusConflict(trip.status);
  }
  await change.check?.(trip);

  const set = typeof change.set === "function" ? change.set(trip) : change.set;
  const changed = Object.entries(set).filter(
    ([key, value]) =>
      (value as unknown) !== undefined && !same(key, trip[key as keyof Trip], value),
  );
  if (changed.length === 0 && !change.always) return { trip, changed: false };

  const data = Object.fromEntries(changed) as TripFields;
  let after: Trip;
  try {
    const { count } = await tx.trip.updateMany({
      where: { id: trip.id, status: trip.status },
      data,
    });
    if (count === 0) throw statusConflict(trip.status);
    after = await tx.trip.findUniqueOrThrow({ where: { id: trip.id } });
  } catch (error) {
    return tripWriteError(error);
  }

  const fields = changed.filter(([key]) => key !== "status" && !UNRECORDED.has(key));
  await recordTripEvent(tx, {
    tripId: trip.id,
    actor: change.actor,
    action: change.action,
    data: {
      ...(after.status !== trip.status && { from: trip.status, to: after.status }),
      ...(fields.length > 0 && {
        changes: Object.fromEntries(
          fields.map(([key, value]) => [
            key,
            { before: jsonValue(trip[key as keyof Trip], key), after: jsonValue(value, key) },
          ]),
        ),
      }),
      ...(typeof change.data === "function" ? change.data(trip) : change.data),
    },
  });
  return { trip: after, changed: true };
};
