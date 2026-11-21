import { tripEventActions, type ProposePrice } from "@terhal/contracts";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import type { Booker } from "../../../platform/http/authenticate";
import type { AuditActor } from "../../audit/index";
import { savePrice } from "../../pricing/index";
import { changeTrip, type TripActor } from "./events";
import { findVisible, lockBooking, readTrip } from "./lifecycle";
import { toSiteTrip, tripSelect } from "./shared";

// Price on request (docs/domains.md, Q3 and its follow-ups): staff propose a price for a trip booked without one, and
// the booker accepts it (every proposed leg of the booking at once) or declines it, which cancels the trip.

const notRequested = () =>
  new AppError({
    code: "PRICE_NOT_REQUESTED",
    status: 409,
    detail: "This trip isn't pending with a price waiting to be set.",
  });

const notProposed = () =>
  new AppError({
    code: "PRICE_NOT_PROPOSED",
    status: 409,
    detail: "There's no proposed price waiting for an answer.",
  });

// Proposing again replaces the earlier proposal. A trip a staff member booked (on the phone) goes straight to ACCEPTED:
// the customer agreed on the phone. `saveToPricing` also writes the price to the price list (needs `pricing`, checked
// by the route).
export const proposePrice = async (
  id: string,
  actor: AuditActor & { staffId: string },
  { totalPrice, note, saveToPricing }: ProposePrice,
) => {
  await prisma.$transaction(async (tx) => {
    const { trip } = await changeTrip(tx, {
      tripId: id,
      actor: { staffId: actor.staffId },
      action: tripEventActions.PRICE_PROPOSED,
      from: ["PENDING"],
      refuse: notRequested,
      check: (current) => {
        if (current.priceState !== "REQUESTED" && current.priceState !== "PROPOSED") {
          throw notRequested();
        }
      },
      set: (current) => ({
        totalPrice,
        priceState: current.staffId ? "ACCEPTED" : "PROPOSED",
      }),
      data: { ...(note && { note }), ...(saveToPricing && { savedToPricing: true }) },
      always: true,
    });
    if (saveToPricing) {
      await savePrice(
        {
          fromId: trip.pickupId,
          toId: trip.dropoffId,
          classId: trip.classId,
          car: trip.car,
          price: totalPrice,
        },
        actor,
        tx,
      );
    }
  });
  return readTrip(id);
};

const siteTrips = async (ids: string[]) => {
  const rows = await prisma.trip.findMany({
    where: { id: { in: ids } },
    orderBy: { pickupDate: "asc" },
    select: tripSelect,
  });
  return { data: rows.map(toSiteTrip) };
};

// The booker accepts every proposed leg of the booking in one go. `expectedPrice` is the total of the proposals they
// saw, so a proposal replaced in the meantime can't be accepted by mistake (PRICE_CHANGED with the current total).
export const acceptPrice = async (booker: Booker, id: string, expectedPrice: string) => {
  const found = await findVisible(booker, id);
  const actor: TripActor = booker;
  const accepted = await prisma.$transaction(async (tx) => {
    const legs = await lockBooking(tx, found);
    const proposed = legs.filter(
      (leg) => leg.status === "PENDING" && leg.priceState === "PROPOSED",
    );
    if (proposed.length === 0) throw notProposed();

    const total = proposed
      .reduce((sum, leg) => sum.plus(leg.totalPrice ?? 0), new Prisma.Decimal(0))
      .toFixed(2);
    if (total !== expectedPrice) {
      throw new AppError({
        code: "PRICE_CHANGED",
        status: 409,
        detail: `The proposed price is now ${total} EGP.`,
        extensions: {
          price: total,
          legs: proposed.map((leg) => ({ id: leg.id, price: leg.totalPrice?.toFixed(2) ?? null })),
        },
      });
    }

    for (const leg of proposed) {
      await changeTrip(tx, {
        tripId: leg.id,
        actor,
        action: tripEventActions.PRICE_ACCEPTED,
        from: ["PENDING"],
        set: { priceState: "ACCEPTED" },
        data: { totalPrice: leg.totalPrice?.toFixed(2) ?? null },
      });
    }
    return proposed.map((leg) => leg.id);
  });
  return siteTrips(accepted);
};

// The booker declines the proposal, which cancels the trip with them as the actor. Declining the outbound also cancels
// its return while that's still pending (R3 a); declining the return leaves the outbound.
export const declinePrice = async (booker: Booker, id: string, reason?: string) => {
  const found = await findVisible(booker, id);
  const actor: TripActor = booker;
  const cancelled = await prisma.$transaction(async (tx) => {
    const legs = await lockBooking(tx, found);
    const target = legs.find((leg) => leg.id === id);
    if (target?.status !== "PENDING" || target.priceState !== "PROPOSED") throw notProposed();

    const going = [
      target,
      ...(target.previousTripId
        ? []
        : legs.filter((leg) => leg.previousTripId === target.id && leg.status === "PENDING")),
    ];
    for (const leg of going) {
      const declined = leg.id === target.id;
      await changeTrip(tx, {
        tripId: leg.id,
        actor,
        action: declined ? tripEventActions.PRICE_DECLINED : tripEventActions.CANCELLED,
        from: ["PENDING"],
        set: { status: "CANCELLED" },
        data: {
          reason: "PRICE_DECLINED",
          ...(reason && { note: reason }),
          ...(!declined && { withTripId: target.id }),
        },
      });
    }
    return going.map((leg) => leg.id);
  });
  return siteTrips(cancelled);
};
