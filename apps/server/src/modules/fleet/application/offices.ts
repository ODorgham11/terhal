import {
  auditActions,
  type CreateOffice,
  type ListOffices,
  type UpdateOffice,
} from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { isLiveLocation } from "../../location/index";
import { liveOfficeTrips } from "../../trips/index";
import { searchWords } from "../domain/rules";
import {
  assertNoLiveTrips,
  auditChanges,
  driverSelect,
  fleetWriteError,
  lockRow,
  matchEveryWord,
  notFound,
  officeSelect,
  pageArgs,
  toDriver,
  toOffice,
  toPage,
  toVehicle,
  vehicleSelect,
  type Client,
  type StaffActor,
} from "./shared";

const ENTITY = "Office";

// Live offices by default, by name.
export const listOffices = async ({ limit, cursor, q, archived }: ListOffices) => {
  const rows = await prisma.office.findMany({
    where: {
      archivedAt: archived ? { not: null } : null,
      AND: matchEveryWord(searchWords(q), ["name", "contact", "phone", "email"]),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    ...pageArgs(limit, cursor),
    select: officeSelect,
  });
  return toPage(rows, limit, toOffice);
};

// The office with its live drivers and vehicles, and the trips handed to it that are still live (soonest first).
export const getOffice = async (id: string) => {
  const office = await prisma.office.findUnique({ where: { id }, select: officeSelect });
  if (!office) throw notFound("office");

  const [drivers, vehicles, trips] = await Promise.all([
    prisma.driver.findMany({
      where: { officeId: id, archivedAt: null },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      select: driverSelect,
    }),
    prisma.vehicle.findMany({
      where: { officeId: id, archivedAt: null },
      orderBy: [{ make: "asc" }, { model: "asc" }, { plateNumber: "asc" }],
      select: vehicleSelect,
    }),
    liveOfficeTrips(id),
  ]);

  const now = new Date();
  return {
    ...toOffice(office),
    drivers: drivers.map((driver) => toDriver(driver, now)),
    vehicles: await Promise.all(vehicles.map(toVehicle)),
    trips,
  };
};

// An office's location must be a live one (an office keeps a link to one deleted since).
const assertLocationAvailable = async (
  client: Client,
  locationId: string | null | undefined,
  currentLocationId: string | null = null,
) => {
  if (!locationId || locationId === currentLocationId) return;
  if (!(await isLiveLocation(locationId, client))) {
    throw new AppError({
      code: "LOCATION_NOT_AVAILABLE",
      status: 422,
      detail: "There's no such location, or it's deleted.",
    });
  }
};

export const createOffice = async (input: CreateOffice, actor: StaffActor) => {
  const id = await prisma
    .$transaction(async (tx) => {
      await assertLocationAvailable(tx, input.locationId);
      const office = await tx.office.create({ data: input, select: { id: true } });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.OFFICE_CREATED,
          entityType: ENTITY,
          entityId: office.id,
          after: auditChanges({}, input).after,
        },
        tx,
      );
      return office.id;
    })
    .catch(fleetWriteError);
  return toOffice(await prisma.office.findUniqueOrThrow({ where: { id }, select: officeSelect }));
};

export const updateOffice = async (id: string, input: UpdateOffice, actor: StaffActor) => {
  await prisma
    .$transaction(async (tx) => {
      if (!(await lockRow(tx, "Office", id))) throw notFound("office");
      const current = await tx.office.findUniqueOrThrow({ where: { id } });
      await assertLocationAvailable(tx, input.locationId, current.locationId);

      await tx.office.update({ where: { id }, data: input });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.OFFICE_UPDATED,
          entityType: ENTITY,
          entityId: id,
          ...auditChanges(current, input),
        },
        tx,
      );
    })
    .catch(fleetWriteError);
  return toOffice(await prisma.office.findUniqueOrThrow({ where: { id }, select: officeSelect }));
};

// Blocked while trips handed to the office are still live. Its drivers and vehicles stay linked but can't be assigned
// through it while it's archived. Archiving an archived office changes nothing.
export const archiveOffice = async (id: string, actor: StaffActor) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Office", id))) throw notFound("office");
    const { archivedAt } = await tx.office.findUniqueOrThrow({ where: { id } });
    if (archivedAt) return;

    await assertNoLiveTrips(tx, { officeId: id }, "office");
    const now = new Date();
    await tx.office.update({ where: { id }, data: { archivedAt: now } });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.OFFICE_ARCHIVED,
        entityType: ENTITY,
        entityId: id,
        after: { archivedAt: now.toISOString() },
      },
      tx,
    );
  });
  return toOffice(await prisma.office.findUniqueOrThrow({ where: { id }, select: officeSelect }));
};

export const restoreOffice = async (id: string, actor: StaffActor) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Office", id))) throw notFound("office");
    const { archivedAt } = await tx.office.findUniqueOrThrow({ where: { id } });
    if (!archivedAt) return;

    await tx.office.update({ where: { id }, data: { archivedAt: null } });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.OFFICE_RESTORED,
        entityType: ENTITY,
        entityId: id,
        before: { archivedAt: archivedAt.toISOString() },
      },
      tx,
    );
  });
  return toOffice(await prisma.office.findUniqueOrThrow({ where: { id }, select: officeSelect }));
};
