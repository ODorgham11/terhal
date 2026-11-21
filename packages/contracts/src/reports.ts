import { z } from "zod";
import { CarBody } from "./cars";
import { Latitude, Longitude } from "./locations";
import { Locale } from "./locale";
import { MAX_PRICE, Price } from "./pricing";
import { TripPlace, TripStatus } from "./trips";

// The driver report (docs/domains.md, D): the per-trip link a driver opens, what they see and submit through it, and
// the report as staff read and correct it.

// --- The link ---

// A link works until 7 days after the trip's pickup (D1 b).
export const REPORT_LINK_VALID_DAYS = 7;

// The report page reads the token from the URL fragment (`/report#<token>`), which never reaches a server, and sends it
// in this header.
export const ReportTokenHeader = z.object({
  "report-token": z
    .string({ error: "The Report-Token header is required." })
    .trim()
    .min(20, "The Report-Token header isn't a report link's token.")
    .max(200, "The Report-Token header isn't a report link's token.")
    .meta({ description: "The token from the report link's fragment, after `#`." }),
});

export const ReportLinkQuery = z.object({
  locale: Locale.default("ar").meta({
    description: "The language of the prefilled WhatsApp message. Arabic by default.",
  }),
});

export const ReportLink = z
  .object({
    url: z.string().meta({
      description: "The link to copy and send to the driver.",
      example: "https://terhal.co/report#3q2-...",
    }),
    whatsappUrl: z.string().meta({
      description: "A wa.me click-to-chat link to the driver's phone, with the message prefilled.",
    }),
    message: z.string().meta({ description: "The prefilled message, with the link in it." }),
    expiresAt: z.iso.datetime(),
    driver: z.object({
      id: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string(),
    }),
  })
  .meta({ id: "ReportLink" });
export type ReportLink = z.infer<typeof ReportLink>;

// --- The report ---

export const expenseTypes = [
  "INTERCITY_TOLL",
  "FUEL",
  "CAR_MAINTENANCE",
  "DRIVER_FEE",
  "OFFICE_FEE",
  "OTHER",
] as const;
export const ExpenseType = z.enum(expenseTypes, { error: "Unknown expense type." }).meta({
  id: "ExpenseType",
  description:
    "DRIVER_FEE is the driver's fee for the trip, for every driver (paid per trip); OFFICE_FEE is what an office is paid for it (staff only, never reimbursed to the driver).",
});
export type ExpenseType = z.infer<typeof ExpenseType>;

// Expenses the driver can't enter themselves: what an office is paid is the company's business (O1 b).
export const STAFF_ONLY_EXPENSES: readonly ExpenseType[] = ["OFFICE_FEE"];

export const REPORT_MAX_STOPS = 20;
export const REPORT_MAX_EXPENSES = 30;

const Instant = (label: string) =>
  z.iso.datetime({ error: `${label} must be an ISO-8601 instant, e.g. 2026-12-01T08:00:00Z.` });

const Place = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(200, `${label} must contain 200 characters at most.`);

const Mileage = (label: string) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number of kilometers.`)
    .min(0, `${label} can't be negative.`)
    .max(9_999_999, `${label} must be 9,999,999 at most.`);

const Notes = z.string().trim().max(500, "Notes must contain 500 characters at most.");

// Zero or more pounds: what the driver collected in cash ("0" when nothing).
const Cash = z
  .string({ error: 'Cash collected must be a decimal string, e.g. "1250.00".' })
  .trim()
  .pipe(
    z
      .string()
      .regex(
        /^\d{1,7}(\.\d{1,2})?$/,
        "Cash collected must be a number of pounds with at most 2 decimals.",
      ),
  )
  .transform((value) => Number(value).toFixed(2))
  .refine((value) => Number(value) <= MAX_PRICE, "Cash collected must be 1,000,000 at most.")
  .meta({ example: "1500.00", description: "EGP collected from the customer; 0 when none." });

const time = (value: string) => new Date(value).getTime();

// A stop is an address or a pin, exactly one (D4, TripStop_address_or_pin).
export const ReportStop = z
  .object({
    address: Place("Address").optional(),
    latitude: Latitude.optional(),
    longitude: Longitude.optional(),
    startedAt: Instant("Stop start"),
    endedAt: Instant("Stop end"),
    notes: Notes.optional(),
  })
  .superRefine((stop, ctx) => {
    const pin = stop.latitude !== undefined || stop.longitude !== undefined;
    if ((stop.latitude === undefined) !== (stop.longitude === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [stop.latitude === undefined ? "latitude" : "longitude"],
        message: "A pin needs both its latitude and its longitude.",
      });
    }
    if (pin === (stop.address !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message: "A stop is either an address or a pin, not both or neither.",
      });
    }
    if (time(stop.endedAt) < time(stop.startedAt)) {
      ctx.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "A stop can't end before it starts.",
      });
    }
  })
  .meta({ id: "ReportStop" });

export const ReportExpense = z
  .object({ type: ExpenseType, amount: Price, notes: Notes.optional() })
  .meta({ id: "ReportExpense" });

// The whole report, every field required (D3 a): drafts stay in the browser, so what's sent is final. The times run in
// order (start, pickup, drop-off, end), stops fall within them, and the odometer never goes back (TripReport_chronology,
// TripReport_mileage).
export const SubmitReport = z
  .object({
    startedAt: Instant("Start time"),
    vehiclePickup: Place("Where the vehicle was picked up"),
    startMileage: Mileage("Start mileage"),
    pickupAt: Instant("Pickup time"),
    dropoffAt: Instant("Drop-off time"),
    vehicleDropoff: Place("Where the vehicle was returned"),
    endedAt: Instant("End time"),
    endMileage: Mileage("End mileage"),
    cashCollected: Cash,
    stops: z
      .array(ReportStop, { error: "Stops are required (an empty list when none)." })
      .max(REPORT_MAX_STOPS, `A report has ${String(REPORT_MAX_STOPS)} stops at most.`),
    expenses: z
      .array(ReportExpense, { error: "Expenses are required (an empty list when none)." })
      .max(REPORT_MAX_EXPENSES, `A report has ${String(REPORT_MAX_EXPENSES)} expenses at most.`),
  })
  .superRefine((report, ctx) => {
    const steps = [
      ["pickupAt", report.startedAt, report.pickupAt, "The pickup can't be before the start."],
      ["dropoffAt", report.pickupAt, report.dropoffAt, "The drop-off can't be before the pickup."],
      ["endedAt", report.dropoffAt, report.endedAt, "The end can't be before the drop-off."],
    ] as const;
    for (const [field, before, after, message] of steps) {
      if (time(after) < time(before)) ctx.addIssue({ code: "custom", path: [field], message });
    }
    if (report.endMileage < report.startMileage) {
      ctx.addIssue({
        code: "custom",
        path: ["endMileage"],
        message: "End mileage can't be less than start mileage.",
      });
    }
    report.stops.forEach((stop, index) => {
      if (
        time(stop.startedAt) < time(report.startedAt) ||
        time(stop.endedAt) > time(report.endedAt)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["stops", index, "startedAt"],
          message: "A stop must fall between the trip's start and end.",
        });
      }
    });
  })
  .meta({ id: "SubmitReport" });
export type SubmitReport = z.output<typeof SubmitReport>;

export const TripReport = z
  .object({
    startedAt: z.iso.datetime(),
    vehiclePickup: z.string(),
    startMileage: z.int(),
    pickupAt: z.iso.datetime(),
    dropoffAt: z.iso.datetime(),
    vehicleDropoff: z.string(),
    endedAt: z.iso.datetime(),
    endMileage: z.int(),
    cashCollected: z.string().meta({ example: "1500.00" }),
    stops: z.array(
      z.object({
        id: z.string(),
        address: z.string().nullable(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        startedAt: z.iso.datetime(),
        endedAt: z.iso.datetime(),
        notes: z.string().nullable(),
      }),
    ),
    expenses: z.array(
      z.object({
        id: z.string(),
        type: ExpenseType,
        amount: z.string().meta({ example: "120.00" }),
        notes: z.string().nullable(),
      }),
    ),
    submittedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "TripReport" });
export type TripReport = z.infer<typeof TripReport>;

// --- What the driver sees through the link ---

export const DriverTrip = z
  .object({
    code: z.string().meta({ example: "TRH-7K3Q9P" }),
    status: TripStatus,
    pickupDate: z.iso.datetime(),
    pickup: TripPlace,
    dropoff: TripPlace,
    clientName: z.string(),
    clientPhone: z.string(),
    passengers: z.int(),
    largeLuggage: z.int(),
    mediumLuggage: z.int(),
    smallLuggage: z.int(),
    car: CarBody,
    class: z.object({ nameEn: z.string(), nameAr: z.string() }),
    notes: z.string().nullable(),
    driver: z.object({ firstName: z.string(), lastName: z.string() }),
    vehicle: z
      .object({ make: z.string(), model: z.string(), color: z.string(), plateNumber: z.string() })
      .nullable(),
    startedAt: z.iso.datetime().nullable().meta({
      description: "When the trip was started (by the driver or staff), to prefill the report.",
    }),
    endedAt: z.iso.datetime().nullable().meta({
      description: "When the trip was ended, to prefill the report.",
    }),
    linkExpiresAt: z.iso.datetime(),
    report: TripReport.nullable().meta({
      description: "The submitted report. Once there is one, it can't be changed through the link.",
    }),
  })
  .meta({ id: "DriverTrip" });
export type DriverTrip = z.infer<typeof DriverTrip>;
