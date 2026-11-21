import { tripEventActions } from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { changeTrip, recordTripEvent } from "./events";
import { readTrip } from "./lifecycle";
import { lockTrip, tripNotFound } from "./shared";

// Linking two existing trips as an outbound and its return (R4 b), e.g. a return booked by phone later. A trip has at
// most one linked trip, so a booking stays a pair.

const linkInvalid = (detail: string) =>
  new AppError({ code: "TRIP_LINK_INVALID", status: 422, detail });

export const linkTrips = async (id: string, returnTripId: string, staffId: string) => {
  if (id === returnTripId) throw linkInvalid("A trip can't be its own return.");
  await prisma.$transaction(async (tx) => {
    for (const tripId of [id, returnTripId].sort()) {
      if (!(await lockTrip(tx, tripId))) throw tripNotFound();
    }
    const trips = await tx.trip.findMany({
      where: { id: { in: [id, returnTripId] } },
      select: {
        id: true,
        pickupDate: true,
        previousTripId: true,
        subsequentTrip: { select: { id: true } },
      },
    });
    const outbound = trips.find((trip) => trip.id === id);
    const back = trips.find((trip) => trip.id === returnTripId);
    if (!outbound || !back) throw tripNotFound();
    if ([outbound, back].some((trip) => trip.previousTripId ?? trip.subsequentTrip)) {
      throw new AppError({
        code: "TRIP_ALREADY_LINKED",
        status: 409,
        detail: "One of these trips is already linked to another. Unlink it first.",
      });
    }
    if (back.pickupDate <= outbound.pickupDate) {
      throw linkInvalid("The return must pick up after the outbound trip.");
    }

    await changeTrip(tx, {
      tripId: returnTripId,
      actor: { staffId },
      action: tripEventActions.LINKED,
      set: { previousTripId: id },
    });
    await recordTripEvent(tx, {
      tripId: id,
      actor: { staffId },
      action: tripEventActions.LINKED,
      data: { returnTripId },
    });
  });
  return readTrip(id);
};

// Unlinks the trip from the one it's linked to, whichever direction; both get an event.
export const unlinkTrip = async (id: string, staffId: string) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockTrip(tx, id))) throw tripNotFound();
    const trip = await tx.trip.findUniqueOrThrow({
      where: { id },
      select: { previousTripId: true, subsequentTrip: { select: { id: true } } },
    });
    const [returnTripId, outboundId] = trip.previousTripId
      ? [id, trip.previousTripId]
      : [trip.subsequentTrip?.id, id];
    if (!returnTripId) {
      throw new AppError({
        code: "TRIP_NOT_LINKED",
        status: 409,
        detail: "This trip isn't linked to another one.",
      });
    }

    await changeTrip(tx, {
      tripId: returnTripId,
      actor: { staffId },
      action: tripEventActions.UNLINKED,
      set: { previousTripId: null },
    });
    await recordTripEvent(tx, {
      tripId: outboundId,
      actor: { staffId },
      action: tripEventActions.UNLINKED,
      data: { returnTripId },
    });
  });
  return readTrip(id);
};
