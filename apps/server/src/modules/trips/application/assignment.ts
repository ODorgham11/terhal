import {
  canServe,
  tripEventActions,
  type AssignTrip,
  type AssignmentCandidates,
  type TripConflict,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { assignableFleet, lockAssignees } from "../../fleet/index";
import { LIVE_STATUSES, conflictWindow } from "../domain/rules";
import { changeTrip, type TripEventData } from "./events";
import { onDriverChanged } from "./hooks";
import { readTrip } from "./lifecycle";
import { conflictSelect, toConflict, tripNotFound } from "./shared";

// Assigning a driver, a vehicle or an office (docs/domain-api.md, A).

const unavailable = (
  code: "DRIVER_NOT_AVAILABLE" | "VEHICLE_NOT_AVAILABLE" | "OFFICE_NOT_AVAILABLE",
  what: string,
) => new AppError({ code, status: 422, detail: `There's no such ${what}, or it's archived.` });

// Other live trips of these drivers and vehicles within ±3 hours of the pickup (A3).
const conflictsAround = async (
  client: Prisma.TransactionClient | typeof prisma,
  tripId: string,
  pickupDate: Date,
  { driverIds, vehicleIds }: { driverIds: string[]; vehicleIds: string[] },
) => {
  if (driverIds.length === 0 && vehicleIds.length === 0) return [];
  const { from, to } = conflictWindow(pickupDate);
  const rows = await client.trip.findMany({
    where: {
      id: { not: tripId },
      status: { in: [...LIVE_STATUSES] },
      pickupDate: { gte: from, lte: to },
      OR: [
        ...(driverIds.length > 0 ? [{ driverId: { in: driverIds } }] : []),
        ...(vehicleIds.length > 0 ? [{ vehicleId: { in: vehicleIds } }] : []),
      ],
    },
    orderBy: [{ pickupDate: "asc" }, { id: "asc" }],
    select: conflictSelect,
  });
  return rows.map(toConflict);
};

// The whole assignment at once, while the trip is pending or confirmed (A1 a). The driver, vehicle and office rows are
// locked first, so an archive can't slip in between the check and the write (A5). The vehicle must be the trip's body
// or larger (A2 b). With an office, the driver and vehicle are optional and must come through it (A4 a; the
// Trip_assignment_matches_office trigger backs this up). A newly set driver or vehicle with another live trip within
// 3 hours is refused with the clashes unless acknowledged (A3). A new driver revokes the report link (D1 b).
export const assignTrip = async (id: string, staffId: string, input: AssignTrip) => {
  const wanted = {
    driverId: input.driverId ?? null,
    vehicleId: input.vehicleId ?? null,
    officeId: input.officeId ?? null,
  };
  const cleared = !wanted.driverId && !wanted.vehicleId && !wanted.officeId;
  let acknowledged: TripConflict[] = [];
  let driverChanged = false;

  await prisma.$transaction(async (tx) => {
    const { trip, changed } = await changeTrip(tx, {
      tripId: id,
      actor: { staffId },
      action: cleared ? tripEventActions.UNASSIGNED : tripEventActions.ASSIGNED,
      from: ["PENDING", "CONFIRMED"],
      check: async (current) => {
        const { driver, vehicle, office } = await lockAssignees(tx, wanted);
        if (wanted.driverId && (!driver || driver.archived)) {
          throw unavailable("DRIVER_NOT_AVAILABLE", "driver");
        }
        if (wanted.vehicleId && (!vehicle || vehicle.archived)) {
          throw unavailable("VEHICLE_NOT_AVAILABLE", "vehicle");
        }
        if (wanted.officeId && (!office || office.archived)) {
          throw unavailable("OFFICE_NOT_AVAILABLE", "office");
        }
        if (vehicle && !canServe(vehicle.body, current.car)) {
          throw new AppError({
            code: "VEHICLE_TOO_SMALL",
            status: 422,
            detail: `A ${vehicle.body} can't serve a trip booked for a ${current.car}.`,
            extensions: { body: vehicle.body, car: current.car },
          });
        }
        if (
          wanted.officeId &&
          ((driver && driver.officeId !== wanted.officeId) ||
            (vehicle && vehicle.officeId !== wanted.officeId))
        ) {
          throw new AppError({
            code: "ASSIGNMENT_OFFICE_MISMATCH",
            status: 422,
            detail: "A trip handed to an office can only have that office's driver and vehicle.",
          });
        }

        const conflicts = await conflictsAround(tx, current.id, current.pickupDate, {
          driverIds:
            wanted.driverId && wanted.driverId !== current.driverId ? [wanted.driverId] : [],
          vehicleIds:
            wanted.vehicleId && wanted.vehicleId !== current.vehicleId ? [wanted.vehicleId] : [],
        });
        if (conflicts.length > 0 && !input.acknowledgeConflicts) {
          throw new AppError({
            code: "ASSIGNMENT_CONFLICT",
            status: 409,
            detail:
              "The driver or the vehicle has another trip within 3 hours of this pickup. Check it, then assign anyway if it's fine.",
            extensions: { conflicts },
          });
        }
        acknowledged = conflicts;
        driverChanged = wanted.driverId !== current.driverId;
      },
      set: (current) => ({
        ...wanted,
        // The report link belongs to the driver it was sent to.
        ...(wanted.driverId !== current.driverId && {
          reportTokenHash: null,
          reportTokenExpiresAt: null,
        }),
      }),
      data: (): TripEventData =>
        acknowledged.length > 0
          ? { acknowledgedConflicts: acknowledged.map((conflict) => conflict.id) }
          : {},
    });
    if (changed && driverChanged) await onDriverChanged(tx, trip);
  });
  return readTrip(id);
};

// Who could be assigned: live drivers, and live vehicles big enough for the trip, each with its clashes (A3).
export const assignmentCandidates = async (id: string): Promise<AssignmentCandidates> => {
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: { id: true, pickupDate: true, car: true },
  });
  if (!trip) throw tripNotFound();

  const fleet = await assignableFleet();
  const vehicles = fleet.vehicles.filter((vehicle) => canServe(vehicle.body, trip.car));
  const conflicts = await conflictsAround(prisma, trip.id, trip.pickupDate, {
    driverIds: fleet.drivers.map((driver) => driver.id),
    vehicleIds: vehicles.map((vehicle) => vehicle.id),
  });

  return {
    drivers: fleet.drivers.map((driver) => ({
      ...driver,
      conflicts: conflicts.filter((conflict) => conflict.driverId === driver.id),
    })),
    vehicles: vehicles.map((vehicle) => ({
      ...vehicle,
      conflicts: conflicts.filter((conflict) => conflict.vehicleId === vehicle.id),
    })),
  };
};
