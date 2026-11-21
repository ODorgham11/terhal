import {
  auditActions,
  type CreateDriver,
  type ListDrivers,
  type ListFleetTrips,
  type UpdateDriver,
} from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { recordAudit } from "../../audit/index";
import { licenseWarningDate, searchWords } from "../domain/rules";
import {
  assertNoLiveTrips,
  assertOfficeAvailable,
  auditChanges,
  driverSelect,
  fleetTripSelect,
  fleetWriteError,
  lockRow,
  matchEveryWord,
  notFound,
  pageArgs,
  toDriver,
  toFleetTrip,
  toPage,
  type StaffActor,
} from "./shared";

const ENTITY = "Driver";

// Live drivers by default, by name.
export const listDrivers = async ({
  limit,
  cursor,
  q,
  external,
  officeId,
  archived,
  licenseExpiring,
}: ListDrivers) => {
  const now = new Date();
  const rows = await prisma.driver.findMany({
    where: {
      archivedAt: archived ? { not: null } : null,
      isExternal: external,
      officeId,
      licenseExpiresAt: licenseExpiring ? { lte: licenseWarningDate(now) } : undefined,
      AND: matchEveryWord(searchWords(q), [
        "firstName",
        "lastName",
        "phone",
        "licenseNumber",
        "nationalId",
      ]),
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
    ...pageArgs(limit, cursor),
    select: driverSelect,
  });
  return toPage(rows, limit, (row) => toDriver(row, now));
};

const findDriver = async (id: string) => {
  const row = await prisma.driver.findUnique({ where: { id }, select: driverSelect });
  if (!row) throw notFound("driver");
  return row;
};

export const getDriver = async (id: string) => toDriver(await findDriver(id));

// The licence expiry is a date (YYYY-MM-DD), stored as a date column.
const expiry = (date: string | undefined) => (date ? new Date(date) : undefined);

export const createDriver = async (input: CreateDriver, actor: StaffActor) => {
  const id = await prisma
    .$transaction(async (tx) => {
      await assertOfficeAvailable(tx, input.officeId);
      const data = { ...input, licenseExpiresAt: new Date(input.licenseExpiresAt) };
      const driver = await tx.driver.create({ data, select: { id: true } });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.DRIVER_CREATED,
          entityType: ENTITY,
          entityId: driver.id,
          after: auditChanges({}, data).after,
        },
        tx,
      );
      return driver.id;
    })
    .catch(fleetWriteError);
  return getDriver(id);
};

export const updateDriver = async (id: string, input: UpdateDriver, actor: StaffActor) => {
  await prisma
    .$transaction(async (tx) => {
      if (!(await lockRow(tx, "Driver", id))) throw notFound("driver");
      const current = await tx.driver.findUniqueOrThrow({ where: { id } });
      await assertOfficeAvailable(tx, input.officeId, current.officeId);

      const data = { ...input, licenseExpiresAt: expiry(input.licenseExpiresAt) };
      await tx.driver.update({ where: { id }, data });
      await recordAudit(
        {
          staffId: actor.staffId,
          ipAddress: actor.ipAddress,
          action: auditActions.DRIVER_UPDATED,
          entityType: ENTITY,
          entityId: id,
          ...auditChanges(current, data),
        },
        tx,
      );
    })
    .catch(fleetWriteError);
  return getDriver(id);
};

// Blocked while the driver is on a live trip. Archiving an archived driver changes nothing.
export const archiveDriver = async (id: string, actor: StaffActor) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Driver", id))) throw notFound("driver");
    const { archivedAt } = await tx.driver.findUniqueOrThrow({ where: { id } });
    if (archivedAt) return;

    await assertNoLiveTrips(tx, { driverId: id }, "driver");
    const now = new Date();
    await tx.driver.update({ where: { id }, data: { archivedAt: now } });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.DRIVER_ARCHIVED,
        entityType: ENTITY,
        entityId: id,
        after: { archivedAt: now.toISOString() },
      },
      tx,
    );
  });
  return getDriver(id);
};

export const restoreDriver = async (id: string, actor: StaffActor) => {
  await prisma.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Driver", id))) throw notFound("driver");
    const { archivedAt } = await tx.driver.findUniqueOrThrow({ where: { id } });
    if (!archivedAt) return;

    await tx.driver.update({ where: { id }, data: { archivedAt: null } });
    await recordAudit(
      {
        staffId: actor.staffId,
        ipAddress: actor.ipAddress,
        action: auditActions.DRIVER_RESTORED,
        entityType: ENTITY,
        entityId: id,
        before: { archivedAt: archivedAt.toISOString() },
      },
      tx,
    );
  });
  return getDriver(id);
};

// TODO: go through the trips module's index once it exists; there's no trips module to ask yet.
// Newest pickup first.
export const listDriverTrips = async (id: string, { limit, cursor, status }: ListFleetTrips) => {
  await findDriver(id);
  const rows = await prisma.trip.findMany({
    where: { driverId: id, status },
    orderBy: [{ pickupDate: "desc" }, { id: "desc" }],
    ...pageArgs(limit, cursor),
    select: fleetTripSelect,
  });
  return toPage(rows, limit, toFleetTrip);
};
