import { TRIP_EXPORT_LIMIT, normalizeSearch, type ExportTrips } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { CSV_BOM, csvLine, type CsvValue } from "../domain/csv";
import { cairoWallClock } from "../domain/months";
import { formatPiastres, toPiastres } from "../domain/money";
import { exportPricing } from "../../pricing/index";

// The on-demand CSV exports (Y4 a and b). Each streams: rows are read a page at a time with a cursor and written as
// they come, so a large export never sits in memory. Every file starts with a byte order mark (Excel and Arabic) and
// escapes text a spreadsheet would run as a formula (domain/csv.ts).

const BATCH = 1000;
const encoder = new TextEncoder();

// Pages of rows after a cursor (the last row's id), until a page comes back short or `limit` rows were read.
export type Fetch<Row> = (args: { take: number; cursor?: string }) => Promise<Row[]>;

export async function* pages<Row extends { id: string }>(
  fetch: Fetch<Row>,
  limit = Number.POSITIVE_INFINITY,
) {
  let cursor: string | undefined;
  let read = 0;
  while (read < limit) {
    const rows = await fetch({ take: Math.min(BATCH, limit - read), cursor });
    if (rows.length > 0) yield rows;
    read += rows.length;
    const last = rows.at(-1);
    if (!last || rows.length < BATCH) return;
    cursor = last.id;
  }
}

async function* lines<Row extends { id: string }>(
  header: readonly string[],
  fetch: Fetch<Row>,
  toValues: (row: Row) => CsvValue[],
  limit?: number,
) {
  yield CSV_BOM + csvLine(header);
  for await (const rows of pages(fetch, limit)) {
    yield rows.map((row) => csvLine(toValues(row))).join("");
  }
}

// Pulled by the response: the next page is read only when the client has taken the last one.
const toStream = (chunks: AsyncGenerator<string, void>) =>
  new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });

// Prisma's cursor paging: skip the cursor row itself.
export const after = (cursor?: string): { cursor?: { id: string }; skip?: number } =>
  cursor ? { cursor: { id: cursor }, skip: 1 } : {};

const iso = (value: Date | null) => value?.toISOString() ?? null;
const name = (who: { firstName: string; lastName: string } | null) =>
  who ? `${who.firstName} ${who.lastName}` : null;

// --- Trips ---

// The same filters as the dashboard's trip list (pickups from `from`, before `to`), so the list can export what it
// shows.
export const tripWhere = ({
  from,
  to,
  status,
  source,
  q,
  driverId,
  vehicleId,
  officeId,
}: ExportTrips): Prisma.TripWhereInput => {
  const words = q ? normalizeSearch(q).split(" ").filter(Boolean) : [];
  return {
    status,
    source,
    driverId,
    vehicleId,
    officeId,
    ...((from ?? to) && {
      pickupDate: { ...(from && { gte: new Date(from) }), ...(to && { lt: new Date(to) }) },
    }),
    AND: words.map((word) => ({
      OR: [
        { code: { contains: word, mode: "insensitive" as const } },
        { clientName: { contains: word, mode: "insensitive" as const } },
        { clientPhone: { contains: word } },
      ],
    })),
  };
};

export const tripSelect = {
  id: true,
  code: true,
  status: true,
  source: true,
  pickupDate: true,
  classSnapshot: true,
  car: true,
  passengers: true,
  smallLuggage: true,
  mediumLuggage: true,
  largeLuggage: true,
  clientName: true,
  clientPhone: true,
  pickupSnapshot: true,
  pickupSnapshotAr: true,
  dropoffSnapshot: true,
  dropoffSnapshotAr: true,
  totalPrice: true,
  priceState: true,
  paymentMethod: true,
  paidAt: true,
  previousTripId: true,
  customer: { select: { firstName: true, lastName: true, email: true } },
  guestSession: { select: { email: true } },
  staff: { select: { firstName: true, lastName: true } },
  driver: { select: { firstName: true, lastName: true, phone: true } },
  vehicle: { select: { plateNumber: true } },
  office: { select: { name: true } },
  report: { select: { expenses: { select: { amount: true } } } },
  createdAt: true,
} satisfies Prisma.TripSelect;

export type TripRow = Prisma.TripGetPayload<{ select: typeof tripSelect }>;

export const TRIP_CSV_HEADER = [
  "code",
  "status",
  "source",
  "pickupDate",
  "pickupCairo",
  "classEn",
  "classAr",
  "car",
  "passengers",
  "smallLuggage",
  "mediumLuggage",
  "largeLuggage",
  "clientName",
  "clientPhone",
  "bookedBy",
  "pickupEn",
  "pickupAr",
  "dropoffEn",
  "dropoffAr",
  "totalPrice",
  "priceState",
  "paymentMethod",
  "paidAt",
  "driver",
  "driverPhone",
  "vehicle",
  "office",
  "expenses",
  "isReturn",
  "createdAt",
] as const;

const snapshotName = (snapshot: Prisma.JsonValue, key: "nameEn" | "nameAr") => {
  const value =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot[key] : null;
  return typeof value === "string" ? value : null;
};

const expensesOf = (trip: TripRow) =>
  trip.report
    ? formatPiastres(
        trip.report.expenses.reduce((sum, { amount }) => sum + toPiastres(amount.toFixed(2)), 0n),
      )
    : null;

const bookedBy = (trip: TripRow) =>
  trip.customer
    ? `customer: ${trip.customer.email}`
    : trip.guestSession
      ? `guest: ${trip.guestSession.email}`
      : trip.staff
        ? `staff: ${name(trip.staff) ?? ""}`
        : null;

export const tripValues = (trip: TripRow): CsvValue[] => [
  trip.code,
  trip.status,
  trip.source,
  trip.pickupDate.toISOString(),
  cairoWallClock(trip.pickupDate),
  snapshotName(trip.classSnapshot, "nameEn"),
  snapshotName(trip.classSnapshot, "nameAr"),
  trip.car,
  trip.passengers,
  trip.smallLuggage,
  trip.mediumLuggage,
  trip.largeLuggage,
  trip.clientName,
  trip.clientPhone,
  bookedBy(trip),
  trip.pickupSnapshot,
  trip.pickupSnapshotAr,
  trip.dropoffSnapshot,
  trip.dropoffSnapshotAr,
  trip.totalPrice?.toFixed(2) ?? null,
  trip.priceState,
  trip.paymentMethod,
  iso(trip.paidAt),
  name(trip.driver),
  trip.driver?.phone ?? null,
  trip.vehicle?.plateNumber ?? null,
  trip.office?.name ?? null,
  expensesOf(trip),
  trip.previousTripId !== null,
  trip.createdAt.toISOString(),
];

// Oldest pickup first.
export const fetchTrips =
  (where: Prisma.TripWhereInput): Fetch<TripRow> =>
  ({ take, cursor }) =>
    prisma.trip.findMany({
      where,
      orderBy: [{ pickupDate: "asc" }, { id: "asc" }],
      take,
      ...after(cursor),
      select: tripSelect,
    });

// Counted before anything is sent, so going over the limit is a clear error rather than a cut file; the stream also
// stops at the limit, in case trips were added in between.
export const exportTrips = async (filters: ExportTrips) => {
  const where = tripWhere(filters);
  const count = await prisma.trip.count({ where });
  if (count > TRIP_EXPORT_LIMIT) {
    throw new AppError({
      code: "EXPORT_TOO_LARGE",
      status: 422,
      detail: `${String(count)} trips match, more than the ${String(TRIP_EXPORT_LIMIT)} one file can hold. Narrow the filters.`,
      extensions: { count, limit: TRIP_EXPORT_LIMIT },
    });
  }
  return toStream(lines(TRIP_CSV_HEADER, fetchTrips(where), tripValues, TRIP_EXPORT_LIMIT));
};

// --- Drivers, vehicles and customers ---

export const DRIVER_CSV_HEADER = [
  "id",
  "firstName",
  "lastName",
  "phone",
  "isExternal",
  "office",
  "licenseNumber",
  "licenseExpiresAt",
  "nationalId",
  "amountOwed",
  "archivedAt",
  "createdAt",
] as const;

export const exportDrivers = () =>
  toStream(
    lines(
      DRIVER_CSV_HEADER,
      ({ take, cursor }) =>
        prisma.driver.findMany({
          orderBy: { id: "asc" },
          take,
          ...after(cursor),
          include: { office: { select: { name: true } } },
        }),
      (driver) => [
        driver.id,
        driver.firstName,
        driver.lastName,
        driver.phone,
        driver.isExternal,
        driver.office?.name ?? null,
        driver.licenseNumber,
        driver.licenseExpiresAt?.toISOString().slice(0, 10) ?? null,
        driver.nationalId,
        driver.amountOwed.toFixed(2),
        iso(driver.archivedAt),
        driver.createdAt.toISOString(),
      ],
    ),
  );

export const VEHICLE_CSV_HEADER = [
  "id",
  "make",
  "model",
  "year",
  "plateNumber",
  "color",
  "body",
  "isExternal",
  "office",
  "archivedAt",
  "createdAt",
] as const;

export const exportVehicles = () =>
  toStream(
    lines(
      VEHICLE_CSV_HEADER,
      ({ take, cursor }) =>
        prisma.vehicle.findMany({
          orderBy: { id: "asc" },
          take,
          ...after(cursor),
          include: { office: { select: { name: true } } },
        }),
      (vehicle) => [
        vehicle.id,
        vehicle.make,
        vehicle.model,
        vehicle.year,
        vehicle.plateNumber,
        vehicle.color,
        vehicle.body,
        vehicle.isExternal,
        vehicle.office?.name ?? null,
        iso(vehicle.archivedAt),
        vehicle.createdAt.toISOString(),
      ],
    ),
  );

export const CUSTOMER_CSV_HEADER = [
  "id",
  "firstName",
  "lastName",
  "phone",
  "email",
  "status",
  "locale",
  "verifiedAt",
  "trips",
  "createdAt",
] as const;

// Deleted accounts are left out.
export const exportCustomers = () =>
  toStream(
    lines(
      CUSTOMER_CSV_HEADER,
      ({ take, cursor }) =>
        prisma.customer.findMany({
          where: { status: { not: "DELETED" } },
          orderBy: { id: "asc" },
          take,
          ...after(cursor),
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            status: true,
            locale: true,
            verifiedAt: true,
            createdAt: true,
            _count: { select: { trips: true } },
          },
        }),
      (customer) => [
        customer.id,
        customer.firstName,
        customer.lastName,
        customer.phone,
        customer.email,
        customer.status,
        customer.locale,
        iso(customer.verifiedAt),
        customer._count.trips,
        customer.createdAt.toISOString(),
      ],
    ),
  );

// The price list belongs to the pricing module, which already exports it (a few thousand rows at most, so not
// streamed); this serves the same file to `analytics`.
export const exportPricingCsv = () => exportPricing();
