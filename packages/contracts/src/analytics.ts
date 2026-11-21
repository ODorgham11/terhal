import { z } from "zod";
import { CarBody } from "./cars";
import { TripStatus } from "./trips";

// Analytics: the dashboard's figures, the monthly workbook and the CSV exports (docs/domains.md, section Y). Days, weeks
// and months are Cairo's; money is EGP as a decimal string with two places, negative only for a margin or a balance.

// --- Rules shared by the API and the dashboard ---

// The trips CSV stops at this many rows; narrow the filters to get the rest.
export const TRIP_EXPORT_LIMIT = 50_000;

// The longest range the analytics page takes, in days.
export const ANALYTICS_MAX_DAYS = 1100;

// The top routes and the busiest drivers and vehicles listed.
export const ANALYTICS_TOP_ROUTES = 10;
export const ANALYTICS_TOP_FLEET = 50;

export const tripSources = ["CUSTOMER", "STAFF"] as const;
export const TripSource = z.enum(tripSources, { error: "Unknown source." }).meta({
  id: "TripSource",
  description: "CUSTOMER: booked on the site (a customer or a guest). STAFF: booked in the dashboard.",
});
export type TripSource = z.infer<typeof TripSource>;

export const expenseTypes = [
  "INTERCITY_TOLL",
  "FUEL",
  "CAR_MAINTENANCE",
  "DRIVER_FEE",
  "OFFICE_FEE",
  "OTHER",
] as const;
export const ExpenseType = z.enum(expenseTypes).meta({ id: "ExpenseType" });
export type ExpenseType = z.infer<typeof ExpenseType>;

export const analyticsGroupings = ["day", "week", "month"] as const;

const Money = z.string().meta({ example: "1250.00", description: "EGP, two decimals." });

// --- The analytics page ---

const CairoDate = (label: string) =>
  z.iso
    .date({ error: `${label} must be a date (YYYY-MM-DD).` })
    .meta({ description: `${label}: a Cairo calendar day, included.`, example: "2026-11-01" });

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export const AnalyticsQuery = z
  .object({
    from: CairoDate("From"),
    to: CairoDate("To"),
    groupBy: z
      .enum(analyticsGroupings, { error: "Group by must be day, week or month." })
      .default("day")
      .meta({ description: "The trend's buckets. Weeks start on Saturday." }),
  })
  .refine((query) => query.from <= query.to, {
    message: "From must not be after to.",
    path: ["to"],
  })
  .refine((query) => dayNumber(query.to) - dayNumber(query.from) < ANALYTICS_MAX_DAYS, {
    message: `The range must be ${String(ANALYTICS_MAX_DAYS)} days at most.`,
    path: ["to"],
  });
export type AnalyticsQuery = z.output<typeof AnalyticsQuery>;

// How a group of trips did: those not cancelled, those completed and what the completed ones earned.
const Performance = {
  trips: z.int().meta({ description: "Trips not cancelled." }),
  completed: z.int(),
  revenue: Money.meta({ description: "The total price of the completed trips." }),
};

const Place = z.object({ id: z.string(), nameEn: z.string(), nameAr: z.string() });

export const Analytics = z
  .object({
    from: z.string(),
    to: z.string(),
    groupBy: z.enum(analyticsGroupings),
    totals: z.object({
      trips: z.int().meta({ description: "Every trip picking up in the range, cancelled ones too." }),
      byStatus: z.record(TripStatus, z.int()),
      completed: z.int(),
      cancelled: z.int(),
      cancellationRate: z.number().meta({ description: "Cancelled trips over all trips, 0 to 1." }),
      revenue: Money.meta({ description: "The total price of completed trips (Y2)." }),
      bookedValue: Money.meta({
        description: "The total price of every trip not cancelled, priced so far, completed ones included.",
      }),
      averageFare: Money.nullable().meta({ description: "Revenue per completed trip." }),
      expenses: Money.meta({
        description: "Every expense on the completed trips' reports, office fees included.",
      }),
      officeFees: Money,
      margin: Money.meta({ description: "Revenue minus expenses." }),
      unpaid: z
        .object({ trips: z.int(), amount: Money })
        .meta({ description: "Completed trips not marked paid." }),
    }),
    trend: z
      .array(
        z.object({
          period: z.string().meta({ description: "The bucket's first day (Cairo), YYYY-MM-DD." }),
          trips: z.int().meta({ description: "Every trip, cancelled ones too." }),
          completed: z.int(),
          cancelled: z.int(),
          revenue: Money,
          bookedValue: Money,
          expenses: Money,
          margin: Money,
        }),
      )
      .meta({ description: "Every bucket in the range, empty ones too, oldest first." }),
    byClass: z.array(
      z.object({ classId: z.string(), nameEn: z.string(), nameAr: z.string(), ...Performance }),
    ),
    byCar: z.array(z.object({ car: CarBody, ...Performance })),
    bySource: z.array(z.object({ source: TripSource, ...Performance })),
    topRoutes: z
      .array(z.object({ from: Place, to: Place, ...Performance }))
      .meta({
        description: `The ${String(ANALYTICS_TOP_ROUTES)} busiest governorate pairs, by trips not cancelled.`,
      }),
    fleet: z.object({
      inHouse: z.object(Performance).meta({ description: "Trips not handed to an office." }),
      office: z.object(Performance).meta({ description: "Trips handed to an office." }),
      byDriver: z
        .array(z.object({ driverId: z.string(), name: z.string(), ...Performance }))
        .meta({ description: `The ${String(ANALYTICS_TOP_FLEET)} busiest drivers.` }),
      byVehicle: z
        .array(z.object({ vehicleId: z.string(), plateNumber: z.string(), ...Performance }))
        .meta({ description: `The ${String(ANALYTICS_TOP_FLEET)} busiest vehicles.` }),
    }),
    costs: z.object({
      byType: z
        .array(z.object({ type: ExpenseType, amount: Money }))
        .meta({ description: "The completed trips' expenses, every type listed." }),
      total: Money,
    }),
    driverBalances: z
      .object({
        owedToDrivers: Money.meta({ description: "What the company owes drivers, in total." }),
        heldByDrivers: Money.meta({ description: "Company cash drivers hold, in total." }),
        drivers: z.int().meta({ description: "Drivers with a balance other than zero." }),
      })
      .meta({ description: "Now, whatever the range." }),
  })
  .meta({ id: "Analytics" });
export type Analytics = z.infer<typeof Analytics>;

// --- Monthly reports ---

export const ReportMonthParams = z.object({
  year: z.coerce
    .number({ error: "Year must be a number." })
    .int("Year must be a whole number.")
    .min(2000, "Year must be 2000 or later.")
    .max(9999, "Year must be 9999 at most."),
  month: z.coerce
    .number({ error: "Month must be a number." })
    .int("Month must be a whole number.")
    .min(1, "Month must be between 1 and 12.")
    .max(12, "Month must be between 1 and 12."),
});
export type ReportMonthParams = z.output<typeof ReportMonthParams>;

export const AnalyticsReport = z
  .object({
    year: z.int(),
    month: z.int(),
    size: z.int().meta({ description: "Bytes." }),
    createdAt: z.iso.datetime(),
    generatedAt: z.iso.datetime().meta({ description: "When it was last generated." }),
  })
  .meta({ id: "AnalyticsReport" });
export type AnalyticsReport = z.infer<typeof AnalyticsReport>;

export const AnalyticsReportLink = z
  .object({
    year: z.int(),
    month: z.int(),
    url: z.string().meta({ description: "Downloads the workbook until it expires." }),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: "AnalyticsReportLink" });
export type AnalyticsReportLink = z.infer<typeof AnalyticsReportLink>;

// --- Exports ---

const ExportId = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must contain 100 characters at most.`);

export const ExportTrips = z.object({
  from: z.iso.datetime({ error: "From must be an ISO-8601 instant." }).optional().meta({
    description: "Pickups at or after this instant.",
  }),
  to: z.iso.datetime({ error: "To must be an ISO-8601 instant." }).optional().meta({
    description: "Pickups before this instant.",
  }),
  status: TripStatus.optional(),
  source: TripSource.optional(),
  q: z.string().trim().max(100, "Search must contain 100 characters at most.").optional().meta({
    description: "Every word must match the code, the passenger's name or their phone.",
  }),
  driverId: ExportId("Driver").optional(),
  vehicleId: ExportId("Vehicle").optional(),
  officeId: ExportId("Office").optional(),
});
export type ExportTrips = z.output<typeof ExportTrips>;
