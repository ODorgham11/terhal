import {
  auditActions,
  type CreateTripClass,
  type SiteTripClass,
  type StaffTripClass,
  type TripClass,
  type UpdateTripClass,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { cairoMonthOf, monthBounds } from "../../analytics/index";
import { recordAudit, type AuditActor } from "../../audit/index";

const select = {
  id: true,
  nameEn: true,
  nameAr: true,
  descriptionEn: true,
  descriptionAr: true,
  sortOrder: true,
  archivedAt: true,
} satisfies Prisma.TripClassSelect;

type Row = Prisma.TripClassGetPayload<{ select: typeof select }>;

const toTripClass = (row: Row): TripClass => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

// What the audit log keeps of a class.
const snapshot = (row: Row) => ({
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  descriptionEn: row.descriptionEn,
  descriptionAr: row.descriptionAr,
  sortOrder: row.sortOrder,
});

// The site's order: sortOrder, then name, then id so ties never shuffle.
const order = [{ sortOrder: "asc" }, { nameEn: "asc" }, { id: "asc" }] as const;

export const tripClassNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no trip class with this id." });

// Two active classes never share a name (the TripClass_active_name* indexes, C2).
const naming = async <T>(write: () => Promise<T>) => {
  try {
    return await write();
  } catch (error) {
    if (violatedUniqueIndex(error)?.startsWith("TripClass_active_name")) {
      throw new AppError({
        code: "TRIP_CLASS_NAME_TAKEN",
        status: 409,
        detail: "Another active class already has this name.",
      });
    }
    throw error;
  }
};

const audit = (
  actor: AuditActor,
  action: (typeof auditActions)[
    "TRIP_CLASS_CREATED" | "TRIP_CLASS_UPDATED" | "TRIP_CLASS_ARCHIVED" | "TRIP_CLASS_RESTORED"],
  entityId: string,
  change: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
  client: Prisma.TransactionClient,
) => recordAudit({ ...actor, action, entityType: "TripClass", entityId, ...change }, client);

// Every active class, or every archived one, in the site's order, with how many prices and this month's trips use
// it. There are only ever a few, so one page.
export const listTripClasses = async ({ archived }: { archived: boolean }, now = new Date()) => {
  const { start, end } = monthBounds(cairoMonthOf(now));
  const rows = await prisma.tripClass.findMany({
    where: { archivedAt: archived ? { not: null } : null },
    orderBy: [...order],
    select: {
      ...select,
      _count: {
        select: {
          pricing: true,
          trips: { where: { pickupDate: { gte: start, lt: end }, status: { not: "CANCELLED" } } },
        },
      },
    },
  });
  const data: StaffTripClass[] = rows.map(({ _count, ...row }) => ({
    ...toTripClass(row),
    prices: _count.pricing,
    tripsThisMonth: _count.trips,
  }));
  return { data, nextCursor: null };
};

export const listSiteTripClasses = async (): Promise<{ data: SiteTripClass[] }> => {
  const rows = await prisma.tripClass.findMany({
    where: { archivedAt: null },
    orderBy: [...order],
    select,
  });
  return {
    data: rows.map((row) => ({
      id: row.id,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      descriptionEn: row.descriptionEn,
      descriptionAr: row.descriptionAr,
      sortOrder: row.sortOrder,
    })),
  };
};

export const createTripClass = async (input: CreateTripClass, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const created = await tx.tripClass.create({
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          descriptionEn: input.descriptionEn ?? null,
          descriptionAr: input.descriptionAr ?? null,
          sortOrder: input.sortOrder,
        },
        select,
      });
      await audit(
        actor,
        auditActions.TRIP_CLASS_CREATED,
        created.id,
        { after: snapshot(created) },
        tx,
      );
      return toTripClass(created);
    }),
  );

// Renaming changes nothing on past trips: they keep the class's name as it was at booking.
export const updateTripClass = async (id: string, input: UpdateTripClass, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.tripClass.findUnique({ where: { id }, select });
      if (!before) throw tripClassNotFound();
      const after = await tx.tripClass.update({ where: { id }, data: input, select });
      await audit(
        actor,
        auditActions.TRIP_CLASS_UPDATED,
        id,
        { before: snapshot(before), after: snapshot(after) },
        tx,
      );
      return toTripClass(after);
    }),
  );

// Archiving (C3) takes the class out of quotes and booking; its prices stay, unused, and existing trips are untouched.
// Restoring brings it back with its prices, unless an active class took its name meanwhile. Either one repeated
// changes nothing.
const setArchived = (archived: boolean) => async (id: string, actor: AuditActor) =>
  naming(() =>
    prisma.$transaction(async (tx) => {
      const before = await tx.tripClass.findUnique({ where: { id }, select });
      if (!before) throw tripClassNotFound();
      if ((before.archivedAt !== null) === archived) return toTripClass(before);

      const after = await tx.tripClass.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select,
      });
      await audit(
        actor,
        archived ? auditActions.TRIP_CLASS_ARCHIVED : auditActions.TRIP_CLASS_RESTORED,
        id,
        {},
        tx,
      );
      return toTripClass(after);
    }),
  );

export const archiveTripClass = setArchived(true);
export const restoreTripClass = setArchived(false);
