import { tripEventActions } from "@terhal/contracts";
import type { Job } from "bullmq";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { runGated } from "../../../platform/jobs/gate";
import { logger } from "../../../platform/logger/logger";
import { overdueAt, overdueBefore } from "../domain/rules";
import { changeTrip, TRIPS_SIGNAL, type SystemJob } from "./events";

// The trips' background jobs, run by the worker on a schedule. Each is idempotent: it moves only trips still in the
// status it looks for, one conditional change per trip, so a retry or a second run in parallel changes nothing twice.

// A trip someone moved meanwhile is skipped, not an error.
const skipMoved = async (change: () => Promise<unknown>) => {
  try {
    await change();
    return 1;
  } catch (error) {
    if (error instanceof AppError && error.code === "TRIP_STATUS_CONFLICT") return 0;
    throw error;
  }
};

const BATCH = 200;

// T5 a and Q3: a pending trip still unconfirmed (or still without an accepted price) at its pickup time is cancelled.
// A trip booked after its pickup time (staff recording one that already happened, `backdated`) is left alone.
const expirable = () => ({
  status: "PENDING" as const,
  createdAt: { lt: prisma.trip.fields.pickupDate },
});

export const expirePendingTrips = async (now = new Date()) => {
  const system: SystemJob = "expire-pending-trips";
  let moved = 0;
  for (;;) {
    const due = await prisma.trip.findMany({
      where: { ...expirable(), pickupDate: { lte: now } },
      orderBy: { pickupDate: "asc" },
      take: BATCH,
      select: { id: true, priceState: true },
    });
    for (const trip of due) {
      moved += await skipMoved(() =>
        prisma.$transaction((tx) =>
          changeTrip(tx, {
            tripId: trip.id,
            actor: { system },
            action: tripEventActions.CANCELLED,
            from: ["PENDING"],
            set: { status: "CANCELLED" },
            data: {
              reason:
                trip.priceState === "REQUESTED" || trip.priceState === "PROPOSED"
                  ? "PRICE_NOT_SETTLED"
                  : "NOT_CONFIRMED",
            },
          }),
        ),
      );
    }
    if (due.length < BATCH) break;
  }
  logger.info({ job: system, moved }, "expired pending trips");
  return moved;
};

// T3 d: an assigned trip, confirmed or in progress, not ended 12 hours after its pickup moves to awaiting report, so
// nothing gets stuck when nobody ends it.
const advanceable = () => ({
  status: { in: ["CONFIRMED" as const, "IN_PROGRESS" as const] },
  OR: [{ officeId: { not: null } }, { driverId: { not: null }, vehicleId: { not: null } }],
});

export const advanceOverdueTrips = async (now = new Date()) => {
  const system: SystemJob = "advance-overdue-trips";
  let moved = 0;
  for (;;) {
    const due = await prisma.trip.findMany({
      where: { ...advanceable(), pickupDate: { lte: overdueBefore(now) } },
      orderBy: { pickupDate: "asc" },
      take: BATCH,
      select: { id: true },
    });
    for (const trip of due) {
      moved += await skipMoved(() =>
        prisma.$transaction((tx) =>
          changeTrip(tx, {
            tripId: trip.id,
            actor: { system },
            action: tripEventActions.ENDED,
            from: ["CONFIRMED", "IN_PROGRESS"],
            set: { status: "AWAITING_REPORT" },
            data: { reason: "OVERDUE" },
          }),
        ),
      );
    }
    if (due.length < BATCH) break;
  }
  logger.info({ job: system, moved }, "advanced overdue trips");
  return moved;
};

// When each job next has work without any trip changing: the earliest pickup still pending, the earliest assigned trip
// becoming overdue. One left behind (a conflict skipped it) is already due, so the job runs again next time.
const nextExpiry = async () =>
  (
    await prisma.trip.findFirst({
      where: expirable(),
      orderBy: { pickupDate: "asc" },
      select: { pickupDate: true },
    })
  )?.pickupDate ?? null;

const nextOverdue = async () => {
  const trip = await prisma.trip.findFirst({
    where: advanceable(),
    orderBy: { pickupDate: "asc" },
    select: { pickupDate: true },
  });
  return trip ? overdueAt(trip.pickupDate) : null;
};

// What the worker schedules: each job by name, how often it runs, what it does, and when it next has work. The
// scheduler ids are the job names, so redeploying replaces the schedule instead of adding another. Each run goes through
// the job gate: it only queries Postgres if a trip changed or a trip is due (platform/jobs/gate.ts).
export const tripJobs = {
  "expire-pending-trips": { every: 60_000, run: expirePendingTrips, next: nextExpiry },
  "advance-overdue-trips": { every: 5 * 60_000, run: advanceOverdueTrips, next: nextOverdue },
} satisfies Record<
  SystemJob,
  { every: number; run: () => Promise<number>; next: () => Promise<Date | null> }
>;

export const processTripJob = async (job: Job) => {
  const name = job.name as SystemJob;
  const entry = tripJobs[name] as (typeof tripJobs)[SystemJob] | undefined;
  if (!entry) throw new Error(`Unknown trips job: ${job.name}`);
  await runGated({ job: name, signal: TRIPS_SIGNAL }, async () => {
    await entry.run();
    return entry.next();
  });
};
