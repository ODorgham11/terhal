import type { CarBody } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { lockRow } from "./shared";

// What the trips module needs to assign drivers, vehicles and offices to a trip. Kept here so fleet's tables stay its
// own.

export interface Assignees {
  driverId?: string | null;
  vehicleId?: string | null;
  officeId?: string | null;
}

export interface LockedAssignees {
  // Null when it wasn't asked for, or doesn't exist.
  driver: { id: string; officeId: string | null; archived: boolean } | null;
  vehicle: { id: string; officeId: string | null; body: CarBody; archived: boolean } | null;
  office: { id: string; archived: boolean } | null;
}

// Locks the rows (FOR UPDATE, in this order) so an archive can't cross the assignment: archiving locks the same row and
// then looks for live trips, so whichever comes second sees the other's result. Then reads them.
export const lockAssignees = async (
  tx: Prisma.TransactionClient,
  { driverId, vehicleId, officeId }: Assignees,
): Promise<LockedAssignees> => {
  const [hasDriver, hasVehicle, hasOffice] = [
    driverId ? await lockRow(tx, "Driver", driverId) : false,
    vehicleId ? await lockRow(tx, "Vehicle", vehicleId) : false,
    officeId ? await lockRow(tx, "Office", officeId) : false,
  ];
  // One after the other: a transaction is one connection.
  const driver =
    hasDriver && driverId
      ? await tx.driver.findUnique({
          where: { id: driverId },
          select: { id: true, officeId: true, archivedAt: true },
        })
      : null;
  const vehicle =
    hasVehicle && vehicleId
      ? await tx.vehicle.findUnique({
          where: { id: vehicleId },
          select: { id: true, officeId: true, body: true, archivedAt: true },
        })
      : null;
  const office =
    hasOffice && officeId
      ? await tx.office.findUnique({
          where: { id: officeId },
          select: { id: true, archivedAt: true },
        })
      : null;
  return {
    driver: driver && {
      id: driver.id,
      officeId: driver.officeId,
      archived: driver.archivedAt !== null,
    },
    vehicle: vehicle && {
      id: vehicle.id,
      officeId: vehicle.officeId,
      body: vehicle.body,
      archived: vehicle.archivedAt !== null,
    },
    office: office && { id: office.id, archived: office.archivedAt !== null },
  };
};

// Live drivers and vehicles someone could assign, by name.
export const assignableFleet = async () => {
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({
      where: { archivedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        isExternal: true,
        officeId: true,
      },
    }),
    prisma.vehicle.findMany({
      where: { archivedAt: null },
      orderBy: [{ make: "asc" }, { model: "asc" }, { plateNumber: "asc" }],
      select: {
        id: true,
        make: true,
        model: true,
        color: true,
        plateNumber: true,
        body: true,
        isExternal: true,
        officeId: true,
      },
    }),
  ]);
  return { drivers, vehicles };
};
