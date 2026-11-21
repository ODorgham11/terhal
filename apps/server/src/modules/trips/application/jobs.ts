import { tripEventActions } from "@terhal/contracts";
import type { Job } from "bullmq";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { overdueBefore } from "../domain/rules";
import { changeTrip, type SystemJob } from "./events";

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
export const expirePendingTrips = async (now = new Date()) => {
  const system: SystemJob = "expire-pending-trips";
  let moved = 0;
  for (;;) {
    const due = await prisma.trip.findMany({
      where: {
        status: "PENDING",
        pickupDate: { lte: now },
        createdAt: { lt: prisma.trip.fields.pickupDate },
      },
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
export const advanceOverdueTrips = async (now = new Date()) => {
  const system: SystemJob = "advance-overdue-trips";
  let moved = 0;
  for (;;) {
    const due = await prisma.trip.findMany({
      where: {
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        pickupDate: { lte: overdueBefore(now) },
        OR: [{ officeId: { not: null } }, { driverId: { not: null }, vehicleId: { not: null } }],
      },
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

// What the worker schedules: each job by name, how often it runs, and what it does. The scheduler ids are the job names,
// so redeploying replaces the schedule instead of adding another.
export const tripJobs = {
  "expire-pending-trips": { every: 60_000, run: expirePendingTrips },
  "advance-overdue-trips": { every: 5 * 60_000, run: advanceOverdueTrips },
} satisfies Record<SystemJob, { every: number; run: () => Promise<number> }>;

export const processTripJob = async (job: Job) => {
  const entry = tripJobs[job.name as SystemJob] as (typeof tripJobs)[SystemJob] | undefined;
  if (!entry) throw new Error(`Unknown trips job: ${job.name}`);
  await entry.run();
};
