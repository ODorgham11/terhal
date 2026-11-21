import {
  ANALYTICS_TOP_FLEET,
  ANALYTICS_TOP_ROUTES,
  expenseTypes,
  tripStatuses,
  type Analytics,
  type AnalyticsQuery,
  type CarBody,
  type ExpenseType,
  type TripSource,
  type TripStatus,
} from "@terhal/contracts";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { averageMoney, rate, subtractMoney } from "../domain/money";

// The analytics page's figures (Y1 a, Y2 a), aggregated by Postgres: no trip rows are loaded. A trip belongs to the
// range by its pickup time, in Cairo days. Revenue is the total price of completed trips; booked value that of every
// trip not cancelled. Costs are the expenses on completed trips' reports (office fees included, O1 b), so the margin
// compares like with like.
// Analytics is a read-only view over other modules' tables (docs/decisions.md, "Analytics reads across modules").

const CAIRO = Prisma.sql`'Africa/Cairo'`;

// Money comes back as text with two decimals, so it never passes through a float.
const money = (expression: Prisma.Sql) =>
  Prisma.sql`coalesce(${expression}, 0)::numeric(16, 2)::text`;

// The Cairo wall clock of a trip's pickup (stored as UTC without a zone).
const local = Prisma.sql`((t."pickupDate" AT TIME ZONE 'UTC') AT TIME ZONE ${CAIRO})`;

// The first day of the bucket a Cairo timestamp falls in. Weeks start on Saturday, as Egyptian calendars do: Postgres
// weeks start on Monday, two days after.
const bucket = (groupBy: AnalyticsQuery["groupBy"], timestamp: Prisma.Sql) => {
  if (groupBy === "week") {
    return Prisma.sql`(date_trunc('week', ${timestamp} + interval '2 days') - interval '2 days')::date`;
  }
  return groupBy === "month"
    ? Prisma.sql`date_trunc('month', ${timestamp})::date`
    : Prisma.sql`date_trunc('day', ${timestamp})::date`;
};

const step = {
  day: Prisma.sql`interval '1 day'`,
  week: Prisma.sql`interval '1 week'`,
  month: Prisma.sql`interval '1 month'`,
};

// Pickups from the start of `from` to the end of `to`, both Cairo days. The bounds are computed once per query and
// compared with the stored column, so the (status, pickupDate) index stays usable.
const inRange = ({ from, to }: AnalyticsQuery) => Prisma.sql`
  t."pickupDate" >= ((${from}::date)::timestamp AT TIME ZONE ${CAIRO}) AT TIME ZONE 'UTC'
  AND t."pickupDate" < ((${to}::date + 1)::timestamp AT TIME ZONE ${CAIRO}) AT TIME ZONE 'UTC'`;

const completed = Prisma.sql`t.status = 'COMPLETED'`;
const notCancelled = Prisma.sql`t.status <> 'CANCELLED'`;

// How a group of trips did: the Performance shape in contracts.
const performance = Prisma.sql`
  count(*) FILTER (WHERE ${notCancelled})::int AS trips,
  count(*) FILTER (WHERE ${completed})::int AS completed,
  ${money(Prisma.sql`sum(t."totalPrice") FILTER (WHERE ${completed})`)} AS revenue`;

// Ties on trips go to the group that earned more. An ORDER BY expression can't use an output column's name.
const byRevenue = Prisma.sql`sum(t."totalPrice") FILTER (WHERE ${completed}) DESC NULLS LAST`;

interface PerformanceRow {
  trips: number;
  completed: number;
  revenue: string;
}

const perf = ({ trips, completed: done, revenue }: PerformanceRow) => ({
  trips,
  completed: done,
  revenue,
});

const totals = async (query: AnalyticsQuery) => {
  const [row] = await prisma.$queryRaw<
    {
      trips: number;
      completed: number;
      cancelled: number;
      revenue: string;
      booked: string;
      unpaid_trips: number;
      unpaid_amount: string;
    }[]
  >`
    SELECT
      count(*)::int AS trips,
      count(*) FILTER (WHERE ${completed})::int AS completed,
      count(*) FILTER (WHERE t.status = 'CANCELLED')::int AS cancelled,
      ${money(Prisma.sql`sum(t."totalPrice") FILTER (WHERE ${completed})`)} AS revenue,
      ${money(Prisma.sql`sum(t."totalPrice") FILTER (WHERE ${notCancelled})`)} AS booked,
      count(*) FILTER (WHERE ${completed} AND t."paidAt" IS NULL)::int AS unpaid_trips,
      ${money(Prisma.sql`sum(t."totalPrice") FILTER (WHERE ${completed} AND t."paidAt" IS NULL)`)} AS unpaid_amount
    FROM "Trip" t
    WHERE ${inRange(query)}`;
  if (!row) throw new Error("An aggregate always returns a row.");
  return row;
};

const byStatus = async (query: AnalyticsQuery) => {
  const rows = await prisma.$queryRaw<{ status: TripStatus; trips: number }[]>`
    SELECT t.status::text AS status, count(*)::int AS trips
    FROM "Trip" t
    WHERE ${inRange(query)}
    GROUP BY t.status`;
  const counts = Object.fromEntries(tripStatuses.map((status) => [status, 0])) as Record<
    TripStatus,
    number
  >;
  for (const row of rows) counts[row.status] = row.trips;
  return counts;
};

const costs = async (query: AnalyticsQuery) => {
  const rows = await prisma.$queryRaw<{ type: ExpenseType; amount: string }[]>`
    SELECT e.type::text AS type, ${money(Prisma.sql`sum(e.amount)`)} AS amount
    FROM "TripExpense" e
    JOIN "TripReport" r ON r.id = e."reportId"
    JOIN "Trip" t ON t.id = r."tripId"
    WHERE ${completed} AND ${inRange(query)}
    GROUP BY e.type`;
  const found = new Map(rows.map((row) => [row.type, row.amount]));
  const byType = expenseTypes.map((type) => ({ type, amount: found.get(type) ?? "0.00" }));
  const [total] = await prisma.$queryRaw<{ amount: string }[]>`
    SELECT ${money(Prisma.sql`sum(e.amount)`)} AS amount
    FROM "TripExpense" e
    JOIN "TripReport" r ON r.id = e."reportId"
    JOIN "Trip" t ON t.id = r."tripId"
    WHERE ${completed} AND ${inRange(query)}`;
  return { byType, total: total?.amount ?? "0.00" };
};

// Every bucket from the one holding `from` to the one holding `to`, empty ones included.
const trend = async (query: AnalyticsQuery) => {
  const { groupBy } = query;
  const rows = await prisma.$queryRaw<
    {
      period: string;
      trips: number;
      completed: number;
      cancelled: number;
      revenue: string;
      booked: string;
      expenses: string;
    }[]
  >`
    WITH periods AS (
      SELECT generate_series(
        ${bucket(groupBy, Prisma.sql`(${query.from}::date)::timestamp`)}::timestamp,
        (${query.to}::date)::timestamp,
        ${step[groupBy]}
      )::date AS period
    ),
    trips AS (
      SELECT ${bucket(groupBy, local)} AS period,
        count(*)::int AS trips,
        count(*) FILTER (WHERE ${completed})::int AS completed,
        count(*) FILTER (WHERE t.status = 'CANCELLED')::int AS cancelled,
        sum(t."totalPrice") FILTER (WHERE ${completed}) AS revenue,
        sum(t."totalPrice") FILTER (WHERE ${notCancelled}) AS booked
      FROM "Trip" t
      WHERE ${inRange(query)}
      GROUP BY 1
    ),
    expenses AS (
      SELECT ${bucket(groupBy, local)} AS period, sum(e.amount) AS amount
      FROM "TripExpense" e
      JOIN "TripReport" r ON r.id = e."reportId"
      JOIN "Trip" t ON t.id = r."tripId"
      WHERE ${completed} AND ${inRange(query)}
      GROUP BY 1
    )
    SELECT to_char(p.period, 'YYYY-MM-DD') AS period,
      coalesce(trips.trips, 0)::int AS trips,
      coalesce(trips.completed, 0)::int AS completed,
      coalesce(trips.cancelled, 0)::int AS cancelled,
      ${money(Prisma.sql`trips.revenue`)} AS revenue,
      ${money(Prisma.sql`trips.booked`)} AS booked,
      ${money(Prisma.sql`expenses.amount`)} AS expenses
    FROM periods p
    LEFT JOIN trips ON trips.period = p.period
    LEFT JOIN expenses ON expenses.period = p.period
    ORDER BY p.period`;
  return rows.map(({ booked, ...row }) => ({
    ...row,
    bookedValue: booked,
    margin: subtractMoney(row.revenue, row.expenses),
  }));
};

const byClass = (query: AnalyticsQuery) =>
  prisma.$queryRaw<(PerformanceRow & { classId: string; nameEn: string; nameAr: string })[]>`
    SELECT c.id AS "classId", c."nameEn", c."nameAr", ${performance}
    FROM "Trip" t
    JOIN "TripClass" c ON c.id = t."classId"
    WHERE ${inRange(query)} AND ${notCancelled}
    GROUP BY c.id
    ORDER BY trips DESC, c."sortOrder", c."nameEn"`;

const byCar = (query: AnalyticsQuery) =>
  prisma.$queryRaw<(PerformanceRow & { car: CarBody })[]>`
    SELECT t.car::text AS car, ${performance}
    FROM "Trip" t
    WHERE ${inRange(query)} AND ${notCancelled}
    GROUP BY t.car
    ORDER BY t.car`;

const bySource = (query: AnalyticsQuery) =>
  prisma.$queryRaw<(PerformanceRow & { source: TripSource })[]>`
    SELECT t.source::text AS source, ${performance}
    FROM "Trip" t
    WHERE ${inRange(query)} AND ${notCancelled}
    GROUP BY t.source
    ORDER BY t.source`;

// The governorate pair of each trip: each end's root in the location tree (governorates have no parent).
const topRoutes = async (query: AnalyticsQuery) => {
  const rows = await prisma.$queryRaw<
    (PerformanceRow & {
      fromId: string;
      fromEn: string;
      fromAr: string;
      toId: string;
      toEn: string;
      toAr: string;
    })[]
  >`
    WITH RECURSIVE ranged AS (
      SELECT t.* FROM "Trip" t WHERE ${inRange(query)} AND ${notCancelled}
    ),
    up AS (
      SELECT l.id AS start, l.id, l."parentId"
      FROM "Location" l
      WHERE l.id IN (SELECT "pickupId" FROM ranged UNION SELECT "dropoffId" FROM ranged)
      UNION ALL
      SELECT up.start, l.id, l."parentId" FROM up JOIN "Location" l ON l.id = up."parentId"
    ),
    root AS (SELECT start, id AS governorate FROM up WHERE "parentId" IS NULL)
    SELECT f.id AS "fromId", f."nameEn" AS "fromEn", f."nameAr" AS "fromAr",
      d.id AS "toId", d."nameEn" AS "toEn", d."nameAr" AS "toAr", ${performance}
    FROM ranged t
    JOIN root pr ON pr.start = t."pickupId"
    JOIN root dr ON dr.start = t."dropoffId"
    JOIN "Location" f ON f.id = pr.governorate
    JOIN "Location" d ON d.id = dr.governorate
    GROUP BY f.id, d.id
    ORDER BY trips DESC, ${byRevenue}, f."nameEn", d."nameEn"
    LIMIT ${ANALYTICS_TOP_ROUTES}`;
  return rows.map((row) => ({
    from: { id: row.fromId, nameEn: row.fromEn, nameAr: row.fromAr },
    to: { id: row.toId, nameEn: row.toEn, nameAr: row.toAr },
    ...perf(row),
  }));
};

const fleet = async (query: AnalyticsQuery) => {
  const [handling, drivers, vehicles] = await Promise.all([
    prisma.$queryRaw<(PerformanceRow & { office: boolean })[]>`
      SELECT (t."officeId" IS NOT NULL) AS office, ${performance}
      FROM "Trip" t
      WHERE ${inRange(query)} AND ${notCancelled}
      GROUP BY 1`,
    prisma.$queryRaw<(PerformanceRow & { driverId: string; name: string })[]>`
      SELECT d.id AS "driverId", d."firstName" || ' ' || d."lastName" AS name, ${performance}
      FROM "Trip" t
      JOIN "Driver" d ON d.id = t."driverId"
      WHERE ${inRange(query)} AND ${notCancelled}
      GROUP BY d.id
      ORDER BY trips DESC, ${byRevenue}, name
      LIMIT ${ANALYTICS_TOP_FLEET}`,
    prisma.$queryRaw<(PerformanceRow & { vehicleId: string; plateNumber: string })[]>`
      SELECT v.id AS "vehicleId", v."plateNumber", ${performance}
      FROM "Trip" t
      JOIN "Vehicle" v ON v.id = t."vehicleId"
      WHERE ${inRange(query)} AND ${notCancelled}
      GROUP BY v.id
      ORDER BY trips DESC, ${byRevenue}, v."plateNumber"
      LIMIT ${ANALYTICS_TOP_FLEET}`,
  ]);
  const none = { trips: 0, completed: 0, revenue: "0.00" };
  const office = handling.find((row) => row.office);
  const inHouse = handling.find((row) => !row.office);
  return {
    inHouse: inHouse ? perf(inHouse) : none,
    office: office ? perf(office) : none,
    byDriver: drivers.map((row) => ({ driverId: row.driverId, name: row.name, ...perf(row) })),
    byVehicle: vehicles.map((row) => ({
      vehicleId: row.vehicleId,
      plateNumber: row.plateNumber,
      ...perf(row),
    })),
  };
};

// Balances now, whatever the range: what the company owes drivers and the cash drivers hold (D8).
const driverBalances = async () => {
  const [row] = await prisma.$queryRaw<{ owed: string; held: string; drivers: number }[]>`
    SELECT ${money(Prisma.sql`sum("amountOwed") FILTER (WHERE "amountOwed" > 0)`)} AS owed,
      ${money(Prisma.sql`-sum("amountOwed") FILTER (WHERE "amountOwed" < 0)`)} AS held,
      count(*) FILTER (WHERE "amountOwed" <> 0)::int AS drivers
    FROM "Driver"`;
  return {
    owedToDrivers: row?.owed ?? "0.00",
    heldByDrivers: row?.held ?? "0.00",
    drivers: row?.drivers ?? 0,
  };
};

export const analytics = async (query: AnalyticsQuery): Promise<Analytics> => {
  const [sums, statuses, cost, buckets, classes, cars, sources, routes, assignees, balances] =
    await Promise.all([
      totals(query),
      byStatus(query),
      costs(query),
      trend(query),
      byClass(query),
      byCar(query),
      bySource(query),
      topRoutes(query),
      fleet(query),
      driverBalances(),
    ]);
  const officeFees = cost.byType.find((row) => row.type === "OFFICE_FEE")?.amount ?? "0.00";
  return {
    from: query.from,
    to: query.to,
    groupBy: query.groupBy,
    totals: {
      trips: sums.trips,
      byStatus: statuses,
      completed: sums.completed,
      cancelled: sums.cancelled,
      cancellationRate: rate(sums.cancelled, sums.trips),
      revenue: sums.revenue,
      bookedValue: sums.booked,
      averageFare: averageMoney(sums.revenue, sums.completed),
      expenses: cost.total,
      officeFees,
      margin: subtractMoney(sums.revenue, cost.total),
      unpaid: { trips: sums.unpaid_trips, amount: sums.unpaid_amount },
    },
    trend: buckets,
    byClass: classes.map((row) => ({
      classId: row.classId,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      ...perf(row),
    })),
    byCar: cars.map((row) => ({ car: row.car, ...perf(row) })),
    bySource: sources.map((row) => ({ source: row.source, ...perf(row) })),
    topRoutes: routes,
    fleet: assignees,
    costs: cost,
    driverBalances: balances,
  };
};
