import type { z } from "zod";
import type {
  CustomerTrip,
  FleetTrip,
  SiteTrip,
  Trip,
  TripConflict,
  TripStatus,
} from "@terhal/contracts";
import { Prisma } from "../../../../generated/prisma/client";
import type { prisma } from "../../../platform/db/prisma";
import { violatedCheck, violatedUniqueIndex } from "../../../platform/db/errors";
import { AppError } from "../../../platform/errors/app-error";

export type Client = typeof prisma | Prisma.TransactionClient;

// --- Errors ---

export const tripNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no trip with this id." });

export const statusConflict = (status: TripStatus, detail = "The trip can't do that now.") =>
  new AppError({
    code: "TRIP_STATUS_CONFLICT",
    status: 409,
    detail: `${detail} It's ${status.toLowerCase().replace("_", " ")}.`,
    extensions: { tripStatus: status },
  });

export const loadDoesNotFit = (cause?: unknown) =>
  new AppError({
    code: "LOAD_DOES_NOT_FIT",
    status: 422,
    detail: "The passengers or the luggage don't fit this car body.",
    cause,
  });

// Turns the database's verdict on a trip write into the error clients get, or rethrows it. The rules live in the trips
// migration; the application checks most of them first, so these are the races and the last line of defence.
export const tripWriteError = (error: unknown): never => {
  const index = violatedUniqueIndex(error);
  if (index === "Trip_one_in_progress_per_driver" || index === "Trip_one_in_progress_per_vehicle") {
    const field = index.endsWith("driver") ? "driver" : "vehicle";
    throw new AppError({
      code: "ASSIGNEE_BUSY",
      status: 409,
      detail: `The ${field} is already on a trip in progress.`,
      extensions: { field },
      cause: error,
    });
  }
  const check = violatedCheck(error);
  if (check === "Trip_fits_car") throw loadDoesNotFit(error);
  if (check === "Trip_priced_before_confirmed") {
    throw new AppError({
      code: "PRICE_NOT_ACCEPTED",
      status: 409,
      detail: "The booker hasn't accepted a price for this trip yet.",
      cause: error,
    });
  }
  if (check === "Trip_assignment_matches_office") {
    throw new AppError({
      code: "ASSIGNMENT_OFFICE_MISMATCH",
      status: 422,
      detail: "A trip handed to an office can only have that office's driver and vehicle.",
      cause: error,
    });
  }
  throw error;
};

// --- Paging ---

export const pageArgs = (limit: number, cursor: string | undefined) => ({
  take: limit + 1,
  ...(cursor && { cursor: { id: cursor }, skip: 1 }),
});

export const toPage = <Row extends { id: string }, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
) => ({
  data: rows.slice(0, limit).map(toItem),
  nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
});

// --- Responses: Prisma models never leave the server ---

const money = (value: Prisma.Decimal | null) => value?.toFixed(2) ?? null;

const person = { select: { id: true, firstName: true, lastName: true, phone: true, email: true } };

export const tripSelect = {
  id: true,
  code: true,
  status: true,
  source: true,
  priceState: true,
  totalPrice: true,
  clientName: true,
  clientPhone: true,
  classId: true,
  classSnapshot: true,
  car: true,
  passengers: true,
  largeLuggage: true,
  mediumLuggage: true,
  smallLuggage: true,
  pickupDate: true,
  pickupId: true,
  pickupSnapshot: true,
  pickupSnapshotAr: true,
  pickupLatitude: true,
  pickupLongitude: true,
  dropoffId: true,
  dropoffSnapshot: true,
  dropoffSnapshotAr: true,
  dropoffLatitude: true,
  dropoffLongitude: true,
  notes: true,
  previousTripId: true,
  subsequentTrip: { select: { id: true } },
  paymentMethod: true,
  paidAt: true,
  customerId: true,
  guestSessionId: true,
  staffId: true,
  driverId: true,
  vehicleId: true,
  officeId: true,
  customer: person,
  guestSession: person,
  staff: person,
  driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
  vehicle: {
    select: { id: true, make: true, model: true, color: true, plateNumber: true, body: true },
  },
  office: { select: { id: true, name: true, phone: true } },
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TripSelect;

export type TripRow = Prisma.TripGetPayload<{ select: typeof tripSelect }>;

const classOf = (row: TripRow) => {
  const snapshot = row.classSnapshot as { nameEn?: string; nameAr?: string } | null;
  return { id: row.classId, nameEn: snapshot?.nameEn ?? "", nameAr: snapshot?.nameAr ?? "" };
};

const commonFields = (row: TripRow) => ({
  id: row.id,
  code: row.code,
  status: row.status,
  priceState: row.priceState,
  totalPrice: money(row.totalPrice),
  clientName: row.clientName,
  clientPhone: row.clientPhone,
  class: classOf(row),
  car: row.car,
  passengers: row.passengers,
  largeLuggage: row.largeLuggage,
  mediumLuggage: row.mediumLuggage,
  smallLuggage: row.smallLuggage,
  pickupDate: row.pickupDate.toISOString(),
  pickup: {
    id: row.pickupId,
    nameEn: row.pickupSnapshot,
    nameAr: row.pickupSnapshotAr,
    latitude: row.pickupLatitude.toNumber(),
    longitude: row.pickupLongitude.toNumber(),
  },
  dropoff: {
    id: row.dropoffId,
    nameEn: row.dropoffSnapshot,
    nameAr: row.dropoffSnapshotAr,
    latitude: row.dropoffLatitude.toNumber(),
    longitude: row.dropoffLongitude.toNumber(),
  },
  notes: row.notes,
  previousTripId: row.previousTripId,
  returnTripId: row.subsequentTrip?.id ?? null,
  createdAt: row.createdAt.toISOString(),
});

const bookerOf = (row: TripRow): Trip["booker"] => {
  const [type, who] = row.customer
    ? (["CUSTOMER", row.customer] as const)
    : row.guestSession
      ? (["GUEST", row.guestSession] as const)
      : (["STAFF", row.staff] as const);
  return {
    type,
    id: who?.id ?? "",
    name: who ? `${who.firstName} ${who.lastName}` : "",
    phone: who?.phone ?? null,
    email: who?.email ?? "",
  };
};

export const toTrip = (row: TripRow): Trip => ({
  ...commonFields(row),
  source: row.source,
  booker: bookerOf(row),
  driver: row.driver,
  vehicle: row.vehicle,
  office: row.office,
  paymentMethod: row.paymentMethod,
  paidAt: row.paidAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

// What the booker sees of the driver and vehicle (A6 a): once the trip is confirmed and assigned. An office trip shows
// its driver and vehicle if they're recorded, and says it's run by a partner.
const SHOWS_ASSIGNMENT: readonly TripStatus[] = [
  "CONFIRMED",
  "IN_PROGRESS",
  "AWAITING_REPORT",
  "COMPLETED",
];

const siteAssignment = (row: TripRow): SiteTrip["assignment"] => {
  if (!SHOWS_ASSIGNMENT.includes(row.status)) return null;
  if (!row.office && !(row.driver && row.vehicle)) return null;
  return {
    driver: row.driver && { firstName: row.driver.firstName, phone: row.driver.phone },
    vehicle: row.vehicle && {
      make: row.vehicle.make,
      model: row.vehicle.model,
      color: row.vehicle.color,
      plateNumber: row.vehicle.plateNumber,
    },
    partner: row.office !== null,
  };
};

export const toSiteTrip = (row: TripRow): SiteTrip => ({
  ...commonFields(row),
  assignment: siteAssignment(row),
});

export const conflictSelect = {
  id: true,
  code: true,
  status: true,
  pickupDate: true,
  driverId: true,
  vehicleId: true,
} as const satisfies Prisma.TripSelect;

export const toConflict = (
  row: Prisma.TripGetPayload<{ select: typeof conflictSelect }>,
): TripConflict => ({ ...row, pickupDate: row.pickupDate.toISOString() });

// --- Trips as the fleet and customer pages list them ---

const officeSummary = { select: { id: true, name: true, archivedAt: true } } as const;

export const fleetTripSelect = {
  id: true,
  code: true,
  status: true,
  pickupDate: true,
  pickupSnapshot: true,
  dropoffSnapshot: true,
  car: true,
  driver: { select: { id: true, firstName: true, lastName: true } },
  vehicle: { select: { id: true, plateNumber: true } },
  office: officeSummary,
} as const satisfies Prisma.TripSelect;

export const toFleetTrip = ({
  pickupSnapshot,
  dropoffSnapshot,
  office,
  ...row
}: Prisma.TripGetPayload<{ select: typeof fleetTripSelect }>): FleetTrip => ({
  ...row,
  pickupDate: row.pickupDate.toISOString(),
  pickup: pickupSnapshot,
  dropoff: dropoffSnapshot,
  office: office && { id: office.id, name: office.name, archived: office.archivedAt !== null },
});

export const customerTripSelect = {
  id: true,
  code: true,
  status: true,
  source: true,
  pickupDate: true,
  pickupSnapshot: true,
  dropoffSnapshot: true,
  car: true,
  passengers: true,
  totalPrice: true,
  priceState: true,
  createdAt: true,
} as const satisfies Prisma.TripSelect;

export const toCustomerTrip = (
  row: Prisma.TripGetPayload<{ select: typeof customerTripSelect }>,
): z.infer<typeof CustomerTrip> => ({
  id: row.id,
  code: row.code,
  status: row.status,
  source: row.source,
  pickupDate: row.pickupDate.toISOString(),
  pickup: row.pickupSnapshot,
  dropoff: row.dropoffSnapshot,
  car: row.car,
  passengers: row.passengers,
  totalPrice: money(row.totalPrice),
  priceState: row.priceState,
  createdAt: row.createdAt.toISOString(),
});

// Locks the trip's row for the rest of the transaction, so two changes to it run one after the other. False when there's
// no such trip.
export const lockTrip = async (tx: Prisma.TransactionClient, id: string) => {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Trip" WHERE "id" = ${id} FOR UPDATE`;
  return rows.length > 0;
};

// A JSON-safe copy of a trip field for an event's data: the price as a string with two places, coordinates as numbers,
// dates as ISO strings.
export const jsonValue = (value: unknown, field?: string): Prisma.InputJsonValue | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const decimal = Prisma.Decimal.isDecimal(value) || field === "totalPrice";
  if (decimal) {
    const number = new Prisma.Decimal(value as string);
    return field === "totalPrice" ? number.toFixed(2) : number.toNumber();
  }
  // Trip fields are otherwise strings, numbers, booleans, enums or JSON.
  return value;
};
