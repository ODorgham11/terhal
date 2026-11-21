import {
  auditActions,
  type CreateVehicle,
  type ListVehicles,
  type UpdateVehicle,
} from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { recordAudit } from "../../audit/index";
import { searchWords } from "../domain/rules";
import {
  assertNoLiveTrips,
  assertOfficeAvailable,
  auditChanges,
  fleetWriteError,
  lockRow,
  matchEveryWord,
  notFound,
  pageArgs,
  toPage,
  toVehicle,
  vehicleSelect,
  type StaffActor,
} from "./shared";

const ENTITY = "Vehicle";

// Live vehicles by default, by make, model and plate.
export const listVehicles = async ({
  limit,
  cursor,
  q,
  body,
  external,
  officeId,
  archived,
}: ListVehicles) => {
  const rows = await prisma.vehicle.findMany({
    where: {
      archivedAt: archived ? { not: null } : null,
      body,
      isExternal: external,
      officeId,
      AND: matchEveryWord(searchWords(q), ["make", "model", "plateNumber", "color"]),
    },
    orderBy: [{ make: "asc" }, { model: "asc" }, { plateNumber: "asc" }, { id: "asc" }],
    ...pageArgs(limit, cursor),
    select: vehicleSelect,
  });
  const page = toPage(rows, limit, toVehicle);
  return { ...page, data: await Promise.all(page.data) };
};

export const getVehicle = async (id: string) => {
  const row = await prisma.vehicle.findUnique({ where: { id }, select: vehicleSelect });
  if (!row) throw notFound("vehicle");
  return toVehicle(row);
};

export const createVehicle = async (input: CreateVehicle, actor: StaffActor) => {
  const id = await prisma
    .$transaction(async (tx) => {
      await assertOfficeAvailable(tx, input.officeId);
      const vehicle = await tx.vehicle.create({ data: input, select: { id: true } });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.VEHICLE_CREATED,
          entityType: ENTITY,
          entityId: vehicle.id,
          after: auditChanges({}, input).after,
        },
        tx,
      );
      return vehicle.id;
    })
    .catch(fleetWriteError);
  return getVehicle(id);
};

export const updateVehicle = async (id: string, input: UpdateVehicle, actor: StaffActor) => {
  await prisma
    .$transaction(async (tx) => {
      if (!(await lockRow(tx, "Vehicle", id))) throw notFound("vehicle");
      const current = await tx.vehicle.findUniqueOrThrow({ where: { id } });
      await assertOfficeAvailable(tx, input.officeId, current.officeId);

      await tx.vehicle.update({ where: { id }, data: input });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.VEHICLE_UPDATED,
          entityType: ENTITY,
          entityId: id,
          ...auditChanges(current, input),
        },
        tx,
      );
    })
    .catch(fleetWriteError);
  return getVehicle(id);
};

// Blocked while the vehicle is on a live trip. Archiving an archived vehicle changes nothing.
export const archiveVehicle = async (id: string, actor: StaffActor) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Vehicle", id))) throw notFound("vehicle");
    const { archivedAt } = await tx.vehicle.findUniqueOrThrow({ where: { id } });
    if (archivedAt) return;

    await assertNoLiveTrips(tx, { vehicleId: id }, "vehicle");
    const now = new Date();
    await tx.vehicle.update({ where: { id }, data: { archivedAt: now } });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.VEHICLE_ARCHIVED,
        entityType: ENTITY,
        entityId: id,
        after: { archivedAt: now.toISOString() },
      },
      tx,
    );
  });
  return getVehicle(id);
};

export const restoreVehicle = async (id: string, actor: StaffActor) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Vehicle", id))) throw notFound("vehicle");
    const { archivedAt } = await tx.vehicle.findUniqueOrThrow({ where: { id } });
    if (!archivedAt) return;

    await tx.vehicle.update({ where: { id }, data: { archivedAt: null } });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.VEHICLE_RESTORED,
        entityType: ENTITY,
        entityId: id,
        before: { archivedAt: archivedAt.toISOString() },
      },
      tx,
    );
  });
  return getVehicle(id);
};
