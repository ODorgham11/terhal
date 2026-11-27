import {
  normalizeSearch,
  type ListCustomerTrips,
  type ListFleetTrips,
  type ListSiteTrips,
  type ListTrips,
  type TripDetail,
  type TripEvent,
  type TripEventAction,
  type TripOverview,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import type { Booker } from "../../../platform/http/authenticate";
import { LIVE_STATUSES, cairoDayStart } from "../domain/rules";
import {
  customerTripSelect,
  fleetTripSelect,
  pageArgs,
  toCustomerTrip,
  toFleetTrip,
  toPage,
  toSiteTrip,
  toTrip,
  tripNotFound,
  tripSelect,
} from "./shared";

const order = [
  { pickupDate: "desc" },
  { id: "desc" },
] satisfies Prisma.TripOrderByWithRelationInput[];

// --- On the site ---

// A customer sees the trips they booked (staff bookings for them included); a verified guest, every guest trip booked
// with the same verified email (B11 b), from any session.
export const visibleTo = async (booker: Booker): Promise<Prisma.TripWhereInput> => {
  if ("customerId" in booker) return { customerId: booker.customerId };
  const { email } = await prisma.guestSession.findUniqueOrThrow({
    where: { id: booker.guestSessionId },
    select: { email: true },
  });
  return { guestSession: { email, verifiedAt: { not: null } } };
};

export const listSiteTrips = async (booker: Booker, { status, cursor, limit }: ListSiteTrips) => {
  const rows = await prisma.trip.findMany({
    where: { ...(await visibleTo(booker)), status },
    orderBy: order,
    ...pageArgs(limit, cursor),
    select: tripSelect,
  });
  return toPage(rows, limit, toSiteTrip);
};

export const getSiteTrip = async (booker: Booker, id: string) => {
  const row = await prisma.trip.findFirst({
    where: { id, ...(await visibleTo(booker)) },
    select: tripSelect,
  });
  if (!row) throw tripNotFound();
  return toSiteTrip(row);
};

// --- In the dashboard ---

const UNASSIGNED: Prisma.TripWhereInput = {
  status: { in: ["PENDING", "CONFIRMED"] },
  officeId: null,
  OR: [{ driverId: null }, { vehicleId: null }],
};

// Newest pickup first. Every word of `q` must match the code, the passenger's name or their phone.
export const listTrips = async ({
  status,
  from,
  to,
  q,
  driverId,
  vehicleId,
  officeId,
  unassigned,
  cursor,
  limit,
}: ListTrips) => {
  const words = q ? normalizeSearch(q).split(" ").filter(Boolean) : [];
  const rows = await prisma.trip.findMany({
    where: {
      status,
      driverId,
      vehicleId,
      officeId,
      ...((from ?? to) && {
        pickupDate: { ...(from && { gte: new Date(from) }), ...(to && { lt: new Date(to) }) },
      }),
      AND: [
        ...words.map((word) => ({
          OR: [
            { code: { contains: word, mode: "insensitive" as const } },
            { clientName: { contains: word, mode: "insensitive" as const } },
            { clientPhone: { contains: word } },
          ],
        })),
        ...(unassigned ? [UNASSIGNED] : []),
      ],
    },
    orderBy: order,
    ...pageArgs(limit, cursor),
    select: tripSelect,
  });
  return toPage(rows, limit, toTrip);
};

const name = (who: { firstName: string; lastName: string } | null) =>
  who ? `${who.firstName} ${who.lastName}` : "";

const toEvent = (
  row: Prisma.TripEventGetPayload<{
    include: {
      staff: { select: { firstName: true; lastName: true } };
      customer: { select: { firstName: true; lastName: true } };
      guestSession: { select: { firstName: true; lastName: true } };
      driver: { select: { firstName: true; lastName: true } };
    };
  }>,
): TripEvent => {
  const actor: TripEvent["actor"] = row.staffId
    ? { type: "STAFF", id: row.staffId, name: name(row.staff) }
    : row.customerId
      ? { type: "CUSTOMER", id: row.customerId, name: name(row.customer) }
      : row.guestSessionId
        ? { type: "GUEST", id: row.guestSessionId, name: name(row.guestSession) }
        : row.driverId
          ? { type: "DRIVER", id: row.driverId, name: name(row.driver) }
          : { type: "SYSTEM", id: null, name: row.system ?? "" };
  return {
    id: row.id,
    action: row.action as TripEventAction,
    actor,
    data: (row.data ?? null) as Record<string, unknown> | null,
    createdAt: row.createdAt.toISOString(),
  };
};

const linkSelect = { id: true, code: true, status: true, pickupDate: true } as const;

const toLink = (row: Prisma.TripGetPayload<{ select: typeof linkSelect }> | null) =>
  row && { ...row, pickupDate: row.pickupDate.toISOString() };

// The trip with its history (oldest first), its linked trips and the driver's report, if any.
export const getTrip = async (id: string): Promise<TripDetail> => {
  const row = await prisma.trip.findUnique({ where: { id }, select: tripSelect });
  if (!row) throw tripNotFound();

  const actorName = { select: { firstName: true, lastName: true } };
  const [events, previousTrip, returnTrip, report] = await Promise.all([
    prisma.tripEvent.findMany({
      where: { tripId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        staff: actorName,
        customer: actorName,
        guestSession: actorName,
        driver: actorName,
      },
    }),
    row.previousTripId
      ? prisma.trip.findUnique({ where: { id: row.previousTripId }, select: linkSelect })
      : null,
    prisma.trip.findUnique({ where: { previousTripId: id }, select: linkSelect }),
    prisma.tripReport.findUnique({ where: { tripId: id }, include: { expenses: true } }),
  ]);

  return {
    ...toTrip(row),
    events: events.map(toEvent),
    previousTrip: toLink(previousTrip),
    returnTrip: toLink(returnTrip),
    report: report && {
      startedAt: report.startedAt.toISOString(),
      vehiclePickup: report.vehiclePickup,
      startMileage: report.startMileage,
      pickupAt: report.pickupAt.toISOString(),
      dropoffAt: report.dropoffAt.toISOString(),
      vehicleDropoff: report.vehicleDropoff,
      endedAt: report.endedAt.toISOString(),
      endMileage: report.endMileage,
      expenses: report.expenses.map((expense) => ({
        id: expense.id,
        type: expense.type,
        amount: expense.amount.toFixed(2),
        notes: expense.notes,
      })),
      updatedAt: report.updatedAt.toISOString(),
    },
  };
};

// The dashboard's front page: what needs attention now. Days are Cairo's (X4).
export const overview = async (now = new Date()): Promise<TripOverview> => {
  const today = cairoDayStart(now);
  const tomorrow = cairoDayStart(now, 1);
  const dayAfter = cairoDayStart(now, 2);
  const notCancelled = { not: "CANCELLED" } as const;

  const [todays, tomorrows, unassigned, inProgress, awaitingReport, overdue, priceRequests] =
    await Promise.all([
      prisma.trip.count({
        where: { status: notCancelled, pickupDate: { gte: today, lt: tomorrow } },
      }),
      prisma.trip.count({
        where: { status: notCancelled, pickupDate: { gte: tomorrow, lt: dayAfter } },
      }),
      prisma.trip.count({ where: UNASSIGNED }),
      prisma.trip.count({ where: { status: "IN_PROGRESS" } }),
      prisma.trip.count({ where: { status: "AWAITING_REPORT" } }),
      prisma.trip.count({
        where: { status: { in: ["PENDING", "CONFIRMED"] }, pickupDate: { lt: now } },
      }),
      prisma.trip.count({ where: { status: "PENDING", priceState: "REQUESTED" } }),
    ]);

  return {
    today: todays,
    tomorrow: tomorrows,
    unassigned,
    inProgress,
    awaitingReport,
    overdue,
    priceRequests,
  };
};

// --- For the fleet and customers modules ---

// The trips handed to an office that are still live, soonest first (at most 100).
export const liveOfficeTrips = async (officeId: string) => {
  const rows = await prisma.trip.findMany({
    where: { officeId, status: { in: [...LIVE_STATUSES] } },
    orderBy: [{ pickupDate: "asc" }, { id: "asc" }],
    take: 100,
    select: fleetTripSelect,
  });
  return rows.map(toFleetTrip);
};

// A driver's trips, newest pickup first, a page at a time.
export const driverTrips = async (driverId: string, { limit, cursor, status }: ListFleetTrips) => {
  const rows = await prisma.trip.findMany({
    where: { driverId, status },
    orderBy: order,
    ...pageArgs(limit, cursor),
    select: fleetTripSelect,
  });
  return toPage(rows, limit, toFleetTrip);
};

const noTrips = () => ({
  tripCount: 0,
  completedCount: 0,
  cancelledCount: 0,
  totalSpent: "0.00",
  lastTripAt: null as string | null,
});

// For each customer: how many trips they booked, completed and cancelled, what the completed ones came to, and the
// latest completed pickup. One grouped query for a whole page of customers.
export const customerTripTotals = async (customerIds: string[]) => {
  const groups = await prisma.trip.groupBy({
    by: ["customerId", "status"],
    where: { customerId: { in: customerIds } },
    _count: { _all: true },
    _sum: { totalPrice: true },
    _max: { pickupDate: true },
  });
  const totals = new Map(customerIds.map((id) => [id, noTrips()]));
  for (const group of groups) {
    const total = group.customerId ? totals.get(group.customerId) : undefined;
    if (!total) continue;
    total.tripCount += group._count._all;
    if (group.status === "CANCELLED") total.cancelledCount += group._count._all;
    // Grouped by status too, so a customer has one completed group: its sum and latest pickup are theirs.
    if (group.status === "COMPLETED") {
      total.completedCount = group._count._all;
      total.totalSpent = (group._sum.totalPrice ?? 0).toFixed(2);
      total.lastTripAt = group._max.pickupDate?.toISOString() ?? null;
    }
  }
  return (customerId: string) => totals.get(customerId) ?? noTrips();
};

// The trips a customer booked (staff bookings for them included), newest pickup first, a page at a time.
export const customerTrips = async (
  customerId: string,
  { status, cursor, limit }: ListCustomerTrips,
) => {
  const rows = await prisma.trip.findMany({
    where: { customerId, status },
    orderBy: order,
    ...pageArgs(limit, cursor),
    select: customerTripSelect,
  });
  return toPage(rows, limit, toCustomerTrip);
};

// A driver's completed trips whose report ended in [start, end), and the kilometres driven on them.
export const driverCompletedTrips = async (driverId: string, start: Date, end: Date) => {
  const rows = await prisma.trip.findMany({
    where: { driverId, status: "COMPLETED", report: { endedAt: { gte: start, lt: end } } },
    select: { report: { select: { startMileage: true, endMileage: true } } },
  });
  const kilometres = rows.reduce(
    (total, { report }) => total + (report ? report.endMileage - report.startMileage : 0),
    0,
  );
  return { tripsCompleted: rows.length, kilometres };
};
