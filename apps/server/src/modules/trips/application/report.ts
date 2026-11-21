import {
  STAFF_ONLY_EXPENSES,
  tripEventActions,
  type DriverTrip,
  type Locale,
  type SubmitReport,
  type TripReport,
} from "@terhal/contracts";
import type { Prisma, Trip } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import { changeTrip, recordTripEvent, type TripActor } from "./events";
import { endTrip, startTrip } from "./lifecycle";
import {
  checkReportToken,
  linkUnavailable,
  newReportLink,
  readReportLink,
  tripForToken,
} from "./report-link";
import { lockTrip, statusConflict, tripNotFound } from "./shared";

// The driver report (docs/domains.md, D): what the driver sees and does through the link, and staff reading and
// correcting the report. The whole report is sent at once (D3 a); once the driver has submitted it, only staff change it
// (D7 b), until the trip is completed.

type Tx = Prisma.TransactionClient;

// --- Responses ---

const reportInclude = {
  stops: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
  expenses: { orderBy: { id: "asc" } },
} as const satisfies Prisma.TripReportInclude;

type ReportRow = Prisma.TripReportGetPayload<{ include: typeof reportInclude }>;

const toReport = (row: ReportRow): TripReport => ({
  startedAt: row.startedAt.toISOString(),
  vehiclePickup: row.vehiclePickup,
  startMileage: row.startMileage,
  pickupAt: row.pickupAt.toISOString(),
  dropoffAt: row.dropoffAt.toISOString(),
  vehicleDropoff: row.vehicleDropoff,
  endedAt: row.endedAt.toISOString(),
  endMileage: row.endMileage,
  cashCollected: row.cashCollected.toFixed(2),
  stops: row.stops.map((stop) => ({
    id: stop.id,
    address: stop.address,
    latitude: stop.latitude?.toNumber() ?? null,
    longitude: stop.longitude?.toNumber() ?? null,
    startedAt: stop.startedAt.toISOString(),
    endedAt: stop.endedAt.toISOString(),
    notes: stop.notes,
  })),
  expenses: row.expenses.map((expense) => ({
    id: expense.id,
    type: expense.type,
    amount: expense.amount.toFixed(2),
    notes: expense.notes,
  })),
  submittedAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const loadReport = async (client: Tx | typeof prisma, tripId: string) => {
  const row = await client.tripReport.findUnique({ where: { tripId }, include: reportInclude });
  return row && toReport(row);
};

// --- Writing a report ---

// Replaces the trip's report with this one (stops and expenses included). Returns whether there was one before.
const writeReport = async (tx: Tx, tripId: string, input: SubmitReport) => {
  const fields = {
    startedAt: new Date(input.startedAt),
    vehiclePickup: input.vehiclePickup,
    startMileage: input.startMileage,
    pickupAt: new Date(input.pickupAt),
    dropoffAt: new Date(input.dropoffAt),
    vehicleDropoff: input.vehicleDropoff,
    endedAt: new Date(input.endedAt),
    endMileage: input.endMileage,
    cashCollected: input.cashCollected,
  };
  const existing = await tx.tripReport.findUnique({ where: { tripId }, select: { id: true } });
  let reportId: string;
  if (existing) {
    reportId = existing.id;
    await tx.tripStop.deleteMany({ where: { reportId } });
    await tx.tripExpense.deleteMany({ where: { reportId } });
    await tx.tripReport.update({ where: { id: reportId }, data: fields });
  } else {
    reportId = (await tx.tripReport.create({ data: { tripId, ...fields }, select: { id: true } }))
      .id;
  }
  await tx.tripStop.createMany({
    data: input.stops.map((stop) => ({
      reportId,
      address: stop.address ?? null,
      latitude: stop.latitude?.toFixed(6) ?? null,
      longitude: stop.longitude?.toFixed(6) ?? null,
      startedAt: new Date(stop.startedAt),
      endedAt: new Date(stop.endedAt),
      notes: stop.notes ?? null,
    })),
  });
  await tx.tripExpense.createMany({
    data: input.expenses.map((expense) => ({
      reportId,
      type: expense.type,
      amount: expense.amount,
      notes: expense.notes ?? null,
    })),
  });
  return existing !== null;
};

// Cash the driver says they collected settles an unpaid trip (B8 b): paid in cash to the driver, when the trip ended.
const recordCashPayment = async (tx: Tx, trip: Trip, input: SubmitReport, actor: TripActor) => {
  if (trip.paidAt || Number(input.cashCollected) === 0) return;
  await changeTrip(tx, {
    tripId: trip.id,
    actor,
    action: tripEventActions.PAYMENT_RECORDED,
    set: { paymentMethod: "CASH_TO_DRIVER", paidAt: new Date(input.endedAt) },
  });
};

// The report as a whole: written, its event recorded, and an unpaid trip settled by the cash collected.
const saveReport = async (tx: Tx, trip: Trip, input: SubmitReport, actor: TripActor) => {
  const replaced = await writeReport(tx, trip.id, input);
  await recordTripEvent(tx, {
    tripId: trip.id,
    actor,
    action: replaced ? tripEventActions.REPORT_EDITED : tripEventActions.REPORT_SUBMITTED,
  });
  await recordCashPayment(tx, trip, input, actor);
};

// --- The driver, through the link ---

// The driver's view: the trip as they need it, when it was started and ended (to prefill the report), and the report
// once it's submitted.
export const driverTrip = async (token: string): Promise<DriverTrip> => {
  const trip = await tripForToken(prisma, token);
  const [row, report, moves] = await Promise.all([
    prisma.trip.findUniqueOrThrow({
      where: { id: trip.id },
      select: {
        driver: { select: { firstName: true, lastName: true } },
        vehicle: { select: { make: true, model: true, color: true, plateNumber: true } },
      },
    }),
    loadReport(prisma, trip.id),
    prisma.tripEvent.findMany({
      where: {
        tripId: trip.id,
        action: { in: [tripEventActions.STARTED, tripEventActions.ENDED] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { action: true, createdAt: true },
    }),
  ]);
  const last = (action: string) =>
    moves.find((event) => event.action === action)?.createdAt.toISOString() ?? null;
  const snapshot = trip.classSnapshot as { nameEn?: string; nameAr?: string } | null;

  return {
    code: trip.code,
    status: trip.status,
    pickupDate: trip.pickupDate.toISOString(),
    pickup: {
      id: trip.pickupId,
      nameEn: trip.pickupSnapshot,
      nameAr: trip.pickupSnapshotAr,
      latitude: trip.pickupLatitude.toNumber(),
      longitude: trip.pickupLongitude.toNumber(),
    },
    dropoff: {
      id: trip.dropoffId,
      nameEn: trip.dropoffSnapshot,
      nameAr: trip.dropoffSnapshotAr,
      latitude: trip.dropoffLatitude.toNumber(),
      longitude: trip.dropoffLongitude.toNumber(),
    },
    clientName: trip.clientName,
    clientPhone: trip.clientPhone,
    passengers: trip.passengers,
    largeLuggage: trip.largeLuggage,
    mediumLuggage: trip.mediumLuggage,
    smallLuggage: trip.smallLuggage,
    car: trip.car,
    class: { nameEn: snapshot?.nameEn ?? "", nameAr: snapshot?.nameAr ?? "" },
    notes: trip.notes,
    driver: row.driver ?? { firstName: "", lastName: "" },
    vehicle: row.vehicle,
    startedAt: trip.status === "CONFIRMED" ? null : last(tripEventActions.STARTED),
    endedAt: ["AWAITING_REPORT", "COMPLETED"].includes(trip.status)
      ? last(tripEventActions.ENDED)
      : null,
    linkExpiresAt: (trip.reportTokenExpiresAt ?? trip.pickupDate).toISOString(),
    report,
  };
};

// T3 d: the driver starts and ends the trip from the link. The token is checked again on the locked trip, so a link
// replaced a moment ago can't act.
export const driverStart = async (token: string) => {
  const { id, driverId } = await tripForToken(prisma, token);
  await startTrip(id, { driverId }, (trip) => checkReportToken(trip, token));
  return driverTrip(token);
};

export const driverEnd = async (token: string) => {
  const { id, driverId } = await tripForToken(prisma, token);
  await endTrip(id, { driverId }, (trip) => checkReportToken(trip, token));
  return driverTrip(token);
};

// The driver submits the report, once (D7 b). A trip still in progress is ended by it. Office fees aren't the
// driver's to enter (O1 b).
export const driverSubmit = async (token: string, input: SubmitReport) => {
  const staffOnly = input.expenses.flatMap((expense, index) =>
    STAFF_ONLY_EXPENSES.includes(expense.type)
      ? [
          {
            in: "json" as const,
            path: `expenses.${String(index)}.type`,
            code: "custom",
            message: "Office fees are entered by staff.",
          },
        ]
      : [],
  );
  if (staffOnly.length > 0) throw validationFailed(staffOnly);

  const { id } = await tripForToken(prisma, token);
  await prisma.$transaction(async (tx) => {
    await lockTrip(tx, id);
    let trip = checkReportToken(await tx.trip.findUnique({ where: { id } }), token);
    const actor = { driverId: trip.driverId };
    if (await tx.tripReport.findUnique({ where: { tripId: id }, select: { id: true } })) {
      throw new AppError({
        code: "REPORT_ALREADY_SUBMITTED",
        status: 409,
        detail: "The report was already submitted. Only staff can change it now.",
      });
    }
    if (trip.status === "IN_PROGRESS") {
      const ended = await changeTrip(tx, {
        tripId: id,
        actor,
        action: tripEventActions.ENDED,
        from: ["IN_PROGRESS"],
        set: { status: "AWAITING_REPORT" },
      });
      trip = { ...ended.trip, driverId: trip.driverId };
    }
    if (trip.status !== "AWAITING_REPORT") {
      throw statusConflict(trip.status, "The report can be sent once the trip has started.");
    }
    await saveReport(tx, trip, input, actor);
  });
  return driverTrip(token);
};

// --- Staff ---

export const getReport = async (tripId: string): Promise<TripReport> => {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { id: true } });
  if (!trip) throw tripNotFound();
  const report = await loadReport(prisma, tripId);
  if (!report) {
    throw new AppError({
      code: "NOT_FOUND",
      status: 404,
      detail: "This trip has no report yet.",
    });
  }
  return report;
};

// Staff fill in the report or correct it while the trip awaits it (D7 b, D9 a), including after reopening (T8 a).
export const putReport = async (tripId: string, staffId: string, input: SubmitReport) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockTrip(tx, tripId))) throw tripNotFound();
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
    if (trip.status !== "AWAITING_REPORT") {
      throw statusConflict(trip.status, "A report can be filled in once the trip has ended.");
    }
    await saveReport(tx, trip, input, { staffId });
  });
  return getReport(tripId);
};

// A new link for the trip's driver (D2 a): the old one stops working. Until the trip is completed or cancelled.
export const regenerateReportLink = async (tripId: string, staffId: string, locale: Locale) => {
  await prisma.$transaction((tx) =>
    changeTrip(tx, {
      tripId,
      actor: { staffId },
      action: tripEventActions.REPORT_LINK_ISSUED,
      from: ["PENDING", "CONFIRMED", "IN_PROGRESS", "AWAITING_REPORT"],
      check: (trip) => {
        if (!trip.driverId) throw linkUnavailable();
      },
      set: (trip) => newReportLink(trip, trip.driverId ?? ""),
      always: true,
    }),
  );
  return readReportLink(tripId, locale);
};
