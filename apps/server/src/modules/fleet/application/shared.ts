import type { Driver, Office, Vehicle } from "@terhal/contracts";
import { Prisma } from "../../../../generated/prisma/client";
import type { prisma } from "../../../platform/db/prisma";
import { violatedCheck, violatedUniqueIndex } from "../../../platform/db/errors";
import { AppError } from "../../../platform/errors/app-error";
import { storage } from "../../../platform/storage/index";
import { LIVE_TRIP_STATUSES, licenseExpiresSoon } from "../domain/rules";

export type Client = typeof prisma | Prisma.TransactionClient;

// The staff member behind a change, for the audit log.
export interface StaffActor {
  staffId: string;
  ipAddress: string | null;
}

export const notFound = (what: string) =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: `There's no such ${what}.` });

// One extra row says whether there's another page, without counting the table.
export const toPage = <Row extends { id: string }, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
) => ({
  data: rows.slice(0, limit).map(toItem),
  nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
});

export const pageArgs = (limit: number, cursor: string | undefined) => ({
  take: limit + 1,
  ...(cursor && { cursor: { id: cursor }, skip: 1 }),
});

interface Contains {
  contains: string;
  mode: "insensitive";
}

// Every word must match one of the fields: "toyota abc" finds a Toyota with plate ABC 1234.
export const matchEveryWord = <Field extends string>(words: string[], fields: Field[]) =>
  words.length === 0
    ? undefined
    : words.map((word) => ({
        OR: fields.map(
          (field) =>
            ({ [field]: { contains: word, mode: "insensitive" } }) as Partial<
              Record<Field, Contains>
            >,
        ),
      }));

const money = (value: Prisma.Decimal) => value.toFixed(2);
const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const instant = (value: Date | null) => value?.toISOString() ?? null;

// Locks the row so a concurrent change to it (e.g. an assignment, an archive) waits for this transaction. False when
// there's no such row.
export const lockRow = async (
  tx: Prisma.TransactionClient,
  table: "Driver" | "Vehicle" | "Office",
  id: string,
) => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} FOR UPDATE`;
  return rows.length > 0;
};

// --- What a change can run into in the database ---

const taken: Record<
  string,
  { code: "DRIVER_PHONE_TAKEN" | "PLATE_NUMBER_TAKEN" | "OFFICE_NAME_TAKEN"; detail: string }
> = {
  Driver_phone_key: { code: "DRIVER_PHONE_TAKEN", detail: "Another driver has this phone number." },
  Vehicle_plateNumber_key: {
    code: "PLATE_NUMBER_TAKEN",
    detail: "Another vehicle has this plate number.",
  },
  Office_name_key: { code: "OFFICE_NAME_TAKEN", detail: "Another office has this name." },
};

// Turns the database's verdict on a fleet write into the error clients get, or rethrows it.
export const fleetWriteError = (error: unknown): never => {
  const index = violatedUniqueIndex(error);
  const duplicate = index ? taken[index] : undefined;
  if (duplicate) throw new AppError({ ...duplicate, status: 409, cause: error });

  const check = violatedCheck(error);
  if (check === "Driver_office_is_external" || check === "Vehicle_office_is_external") {
    throw new AppError({
      code: "OFFICE_REQUIRES_EXTERNAL",
      status: 422,
      detail: "Only an external driver or vehicle can come through an office.",
      cause: error,
    });
  }
  throw error;
};

// A driver or a vehicle can only be linked to a live office. Keeping an existing link to one archived since is fine.
export const assertOfficeAvailable = async (
  client: Client,
  officeId: string | null | undefined,
  currentOfficeId: string | null = null,
) => {
  if (!officeId || officeId === currentOfficeId) return;
  const office = await client.office.findFirst({
    where: { id: officeId, archivedAt: null },
    select: { id: true },
  });
  if (!office) {
    throw new AppError({
      code: "OFFICE_NOT_AVAILABLE",
      status: 422,
      detail: "There's no such office, or it's archived.",
    });
  }
};

// The live trips a driver, a vehicle or an office is on, which block archiving it.
export const assertNoLiveTrips = async (
  tx: Prisma.TransactionClient,
  where: Prisma.TripWhereInput,
  what: string,
) => {
  const trips = await tx.trip.findMany({
    where: { ...where, status: { in: [...LIVE_TRIP_STATUSES] } },
    orderBy: { pickupDate: "asc" },
    take: 10,
    select: { id: true, code: true, pickupDate: true, status: true },
  });
  if (trips.length > 0) {
    throw new AppError({
      code: "HAS_UPCOMING_TRIPS",
      status: 409,
      detail: `This ${what} is on trips that are still live. Reassign or finish them first.`,
      extensions: {
        trips: trips.map((trip) => ({ ...trip, pickupDate: trip.pickupDate.toISOString() })),
      },
    });
  }
};

// --- Responses: Prisma models never leave the server, every response is built here ---

export const officeSummarySelect = { select: { id: true, name: true, archivedAt: true } } as const;

const toOfficeSummary = (office: { id: string; name: string; archivedAt: Date | null } | null) =>
  office && { id: office.id, name: office.name, archived: office.archivedAt !== null };

export const driverSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  licenseNumber: true,
  licenseExpiresAt: true,
  nationalId: true,
  isExternal: true,
  office: officeSummarySelect,
  amountOwed: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.DriverSelect;

type DriverRow = Prisma.DriverGetPayload<{ select: typeof driverSelect }>;

export const toDriver = (row: DriverRow, now = new Date()): Driver => ({
  ...row,
  licenseExpiresAt: day(row.licenseExpiresAt),
  licenseExpiresSoon: licenseExpiresSoon(row.licenseExpiresAt, now),
  office: toOfficeSummary(row.office),
  amountOwed: money(row.amountOwed),
  archivedAt: instant(row.archivedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const vehicleSelect = {
  id: true,
  make: true,
  model: true,
  year: true,
  plateNumber: true,
  color: true,
  body: true,
  isExternal: true,
  office: officeSummarySelect,
  images: { select: { id: true, key: true, position: true }, orderBy: { position: "asc" } },
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.VehicleSelect;

type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;

// Every image gets a fresh signed link (made locally, no network call with either driver).
export const toVehicle = async ({ images, ...row }: VehicleRow): Promise<Vehicle> => ({
  ...row,
  office: toOfficeSummary(row.office),
  images: await Promise.all(
    images.map(async (image) => ({
      id: image.id,
      position: image.position,
      url: await storage.signedUrl(image.key),
    })),
  ),
  archivedAt: instant(row.archivedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const officeSelect = {
  id: true,
  name: true,
  contact: true,
  phone: true,
  email: true,
  address: true,
  location: { select: { id: true, nameEn: true, nameAr: true, locality: true } },
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.OfficeSelect;

type OfficeRow = Prisma.OfficeGetPayload<{ select: typeof officeSelect }>;

export const toOffice = (row: OfficeRow): Office => ({
  ...row,
  archivedAt: instant(row.archivedAt),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

// The fields a change touched, before and after, for the audit log. Dates become ISO strings.
export const auditChanges = <T extends Record<string, unknown>>(before: T, changes: Partial<T>) => {
  const json = (value: unknown) =>
    value instanceof Date ? value.toISOString() : (value as Prisma.InputJsonValue | null);
  const keys = Object.keys(changes).filter((key) => changes[key] !== undefined);
  return {
    before: Object.fromEntries(keys.map((key) => [key, json(before[key])])),
    after: Object.fromEntries(keys.map((key) => [key, json(changes[key])])),
  };
};
