import { tripEventActions, type CancelTrip, type TripStatus } from "@terhal/contracts";
import type { Prisma, Trip } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import type { Booker } from "../../../platform/http/authenticate";
import { cairoMonth, isAssigned } from "../domain/rules";
import { changeTrip, type TripActor } from "./events";
import { onTripCompleted, onTripReopened } from "./hooks";
import { visibleTo } from "./queries";
import { lockTrip, statusConflict, toSiteTrip, toTrip, tripNotFound, tripSelect } from "./shared";

// The status lifecycle (docs/domains.md, T): one action per route (X9), each a conditional move on the current
// status that writes its event.

export const readTrip = async (id: string) =>
  toTrip(await prisma.trip.findUniqueOrThrow({ where: { id }, select: tripSelect }));

const move = async (
  id: string,
  actor: TripActor,
  {
    action,
    from,
    to,
    check,
    data,
    after,
  }: {
    action: Parameters<typeof changeTrip>[1]["action"];
    from: readonly TripStatus[];
    to: TripStatus;
    check?: (trip: Trip) => void | Promise<void>;
    data?: Parameters<typeof changeTrip>[1]["data"];
    after?: (tx: Prisma.TransactionClient, trip: Trip) => Promise<void>;
  },
) => {
  await prisma.$transaction(async (tx) => {
    const { trip } = await changeTrip(tx, {
      tripId: id,
      actor,
      action,
      from,
      check,
      set: { status: to },
      data,
    });
    await after?.(tx, trip);
  });
  return readTrip(id);
};

// T1 a: staff accept the booking. Only with a price the booker has seen (Trip_priced_before_confirmed backs this up).
export const confirmTrip = (id: string, staffId: string) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.CONFIRMED,
      from: ["PENDING"],
      to: "CONFIRMED",
      check: (trip) => {
        if (trip.priceState !== "QUOTED" && trip.priceState !== "ACCEPTED") {
          throw new AppError({
            code: "PRICE_NOT_ACCEPTED",
            status: 409,
            detail: "The booker hasn't accepted a price for this trip yet.",
            extensions: { priceState: trip.priceState },
          });
        }
      },
    },
  );

// T2 a: a driver and a vehicle, or an office. A driver or vehicle already on a trip in progress is refused by the
// database (ASSIGNEE_BUSY).
export const startTrip = (id: string, staffId: string) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.STARTED,
      from: ["CONFIRMED"],
      to: "IN_PROGRESS",
      check: (trip) => {
        if (!isAssigned(trip)) {
          throw new AppError({
            code: "ASSIGNMENT_REQUIRED",
            status: 409,
            detail: "Assign a driver and a vehicle, or an office, before starting the trip.",
          });
        }
      },
    },
  );

export const endTrip = (id: string, staffId: string) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.ENDED,
      from: ["IN_PROGRESS"],
      to: "AWAITING_REPORT",
    },
  );

// T4 a: staff review the report and complete the trip; the driver ledger hooks in here (D8 a).
export const completeTrip = (id: string, staffId: string) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.COMPLETED,
      from: ["AWAITING_REPORT"],
      to: "COMPLETED",
      after: (tx, trip) => onTripCompleted(tx, trip, { staffId }),
    },
  );

// T7 a: pending, confirmed or in progress (a no-show, a breakdown), with a reason.
export const cancelTrip = (id: string, staffId: string, { reason, note }: CancelTrip) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.CANCELLED,
      from: ["PENDING", "CONFIRMED", "IN_PROGRESS"],
      to: "CANCELLED",
      data: { reason, ...(note && { note }) },
    },
  );

// T8 a: undoing a start made by mistake.
export const unstartTrip = (id: string, staffId: string) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.START_UNDONE,
      from: ["IN_PROGRESS"],
      to: "CONFIRMED",
    },
  );

// T8 a: reopening a completed trip's report, until its month's report (AnalyticsDocument, by the pickup's Cairo month)
// is generated. What completing wrote to the ledger is reversed through the hook.
// The analytics module doesn't exist yet, so its table is read here.
export const reopenTrip = (id: string, staffId: string) =>
  move(
    id,
    { staffId },
    {
      action: tripEventActions.REOPENED,
      from: ["COMPLETED"],
      to: "AWAITING_REPORT",
      check: async (trip) => {
        const month = cairoMonth(trip.pickupDate);
        const document = await prisma.analyticsDocument.findUnique({
          where: { year_month: month },
          select: { id: true },
        });
        if (document) {
          throw new AppError({
            code: "MONTH_REPORT_GENERATED",
            status: 409,
            detail: "This trip's month already has its report, so the trip can't be reopened.",
            extensions: month,
          });
        }
      },
      after: (tx, trip) => onTripReopened(tx, trip, { staffId }),
    },
  );

// --- The booking a trip belongs to: the trip, the one it returns from and its return ---

// The legs of a booking, outbound first, locked in a fixed order so two changes to one booking can't deadlock.
export const lockBooking = async (tx: Prisma.TransactionClient, trip: Trip) => {
  const ids = new Set([trip.id]);
  if (trip.previousTripId) ids.add(trip.previousTripId);
  const next = await tx.trip.findUnique({
    where: { previousTripId: trip.id },
    select: { id: true },
  });
  if (next) ids.add(next.id);
  for (const id of [...ids].sort()) await lockTrip(tx, id);
  const legs = await tx.trip.findMany({ where: { id: { in: [...ids] } } });
  return legs.sort((a, b) => a.pickupDate.getTime() - b.pickupDate.getTime());
};

// A trip the booker can see, or a 404.
export const findVisible = async (booker: Booker, id: string) => {
  const trip = await prisma.trip.findFirst({ where: { id, ...(await visibleTo(booker)) } });
  if (!trip) throw tripNotFound();
  return trip;
};

const callToCancel = () =>
  new AppError({
    code: "CALL_TO_CANCEL",
    status: 409,
    detail: "This trip is confirmed, so it can't be cancelled online. Please call us to cancel it.",
  });

const STARTED: readonly TripStatus[] = ["IN_PROGRESS", "AWAITING_REPORT", "COMPLETED"];

// A customer or a guest cancelling on the site (T6, R3 a). Only pending trips: a confirmed one has to be cancelled by
// phone. The whole booking goes, both legs, or only the return when the outbound has already started.
export const cancelOnline = async (booker: Booker, id: string, reason?: string) => {
  const found = await findVisible(booker, id);
  const actor: TripActor = booker;
  const cancelled = await prisma.$transaction(async (tx) => {
    const legs = await lockBooking(tx, found);
    const target = legs.find((leg) => leg.id === id) ?? found;
    if (target.status === "CONFIRMED") throw callToCancel();
    if (target.status !== "PENDING")
      throw statusConflict(target.status, "Only a pending trip can be cancelled.");

    // A leg that started (the outbound, say) stays as it is; the rest goes.
    const going = legs.filter((leg) => leg.status !== "CANCELLED" && !STARTED.includes(leg.status));
    if (going.some((leg) => leg.status === "CONFIRMED")) throw callToCancel();

    for (const leg of going) {
      await changeTrip(tx, {
        tripId: leg.id,
        actor,
        action: tripEventActions.CANCELLED,
        from: ["PENDING"],
        set: { status: "CANCELLED" },
        data: {
          reason: "CUSTOMER_REQUEST",
          ...(reason && { note: reason }),
          ...(leg.id !== id && { withTripId: id }),
        },
      });
    }
    return going.map((leg) => leg.id);
  });
  const rows = await prisma.trip.findMany({
    where: { id: { in: cancelled } },
    orderBy: { pickupDate: "asc" },
    select: tripSelect,
  });
  return { data: rows.map(toSiteTrip) };
};
