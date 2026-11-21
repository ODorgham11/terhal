import { z } from "zod";
import { CarBody } from "./cars";
import { Email, Name, Phone } from "./fields";

// Drivers, vehicles and offices, managed in the dashboard (the `fleet` permission; reads also with `trips`).

const Id = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must contain 100 characters at most.`);

const Text = (label: string, max: number) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must contain ${max} characters at most.`);

const Notes = z.string().trim().max(500, "Notes must contain 500 characters at most.");

// A query flag: ?archived=true.
const Flag = (label: string) =>
  z
    .enum(["true", "false"], { error: `${label} must be true or false.` })
    .transform((value) => value === "true");

const PageQuery = {
  limit: z.coerce
    .number({ error: "Limit must be a number." })
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(100, "Limit must be 100 at most.")
    .default(50),
  // The id of the last item on the current page. The next page starts right after it.
  cursor: Id("Cursor").optional(),
};

const Search = z.string().trim().max(100, "Search must contain 100 characters at most.");

// Money in Egyptian pounds, as a decimal string with up to two places, e.g. "1250.50".
const Amount = z
  .string({ error: "Amount is required." })
  .trim()
  .regex(/^-?\d{1,9}(\.\d{1,2})?$/, "Amount must be a number with at most two decimals.")
  .meta({ example: "500.00" });

const archived = z.iso.datetime().nullable().meta({ description: "Set while archived." });

export const OfficeSummary = z
  .object({ id: z.string(), name: z.string(), archived: z.boolean() })
  .meta({ id: "OfficeSummary" });

// --- Drivers ---

// How long before its expiry a licence is flagged in the dashboard.
export const LICENSE_EXPIRY_WARNING_DAYS = 30;

export const Driver = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    // Required for new drivers; empty only on rows from before it was.
    licenseNumber: z.string().nullable(),
    licenseExpiresAt: z.iso.date().nullable(),
    licenseExpiresSoon: z.boolean().meta({
      description: `The licence has expired or expires within ${LICENSE_EXPIRY_WARNING_DAYS} days (Cairo time).`,
    }),
    nationalId: z.string().nullable(),
    isExternal: z.boolean(),
    office: OfficeSummary.nullable(),
    amountOwed: z.string().meta({
      description:
        "What the company owes the driver in EGP; negative when the driver holds company cash. Kept by the ledger.",
      example: "250.00",
    }),
    notes: z.string().nullable(),
    archivedAt: archived,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Driver" });

export type Driver = z.infer<typeof Driver>;

const DriverFields = {
  firstName: Name("First name"),
  lastName: Name("Last name"),
  phone: Phone,
  licenseNumber: Text("Licence number", 50),
  licenseExpiresAt: z.iso.date({ error: "Licence expiry must be a date (YYYY-MM-DD)." }),
  nationalId: Text("National ID", 30).nullable(),
  isExternal: z.boolean({ error: "External must be true or false." }),
  // Only an external driver can come through an office.
  officeId: Id("Office").nullable(),
  notes: Notes.nullable(),
};

export const CreateDriver = z
  .object({
    ...DriverFields,
    nationalId: DriverFields.nationalId.optional(),
    isExternal: DriverFields.isExternal.default(false),
    officeId: DriverFields.officeId.optional(),
    notes: DriverFields.notes.optional(),
  })
  .meta({ id: "CreateDriver" });

export type CreateDriver = z.output<typeof CreateDriver>;

// Only the fields sent change; null clears an optional one.
export const UpdateDriver = z.object(DriverFields).partial().meta({ id: "UpdateDriver" });

export type UpdateDriver = z.output<typeof UpdateDriver>;

export const ListDrivers = z.object({
  ...PageQuery,
  // Name, phone, licence number or national ID.
  q: Search.optional(),
  external: Flag("External").optional(),
  officeId: Id("Office").optional(),
  // Archived drivers only; live ones by default.
  archived: Flag("Archived").default(false),
  // Only licences that have expired or expire within 30 days.
  licenseExpiring: Flag("Licence expiring").optional(),
});

export type ListDrivers = z.output<typeof ListDrivers>;

// --- Trips, as fleet and office pages list them ---

const tripStatuses = [
  "PENDING",
  "CANCELLED",
  "CONFIRMED",
  "IN_PROGRESS",
  "AWAITING_REPORT",
  "COMPLETED",
] as const;

export const FleetTrip = z
  .object({
    id: z.string(),
    code: z.string(),
    status: z.enum(tripStatuses),
    pickupDate: z.iso.datetime(),
    pickup: z.string().meta({ description: "The pickup's name at booking." }),
    dropoff: z.string().meta({ description: "The drop-off's name at booking." }),
    car: CarBody,
    driver: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }).nullable(),
    vehicle: z.object({ id: z.string(), plateNumber: z.string() }).nullable(),
    office: OfficeSummary.nullable(),
  })
  .meta({ id: "FleetTrip" });

export type FleetTrip = z.infer<typeof FleetTrip>;

export const ListFleetTrips = z.object({
  ...PageQuery,
  status: z.enum(tripStatuses, { error: "Unknown status." }).optional(),
});

export type ListFleetTrips = z.output<typeof ListFleetTrips>;

// --- The driver's ledger ---

export const driverTransactionTypes = [
  "TRIP_FEE",
  "EXPENSE_REIMBURSEMENT",
  "CASH_COLLECTED",
  "PAYOUT",
  "ADJUSTMENT",
] as const;

export const DriverTransaction = z
  .object({
    id: z.string(),
    type: z.enum(driverTransactionTypes),
    amount: z.string().meta({
      description: "Positive when the company owes the driver more, negative when less.",
      example: "-500.00",
    }),
    trip: z.object({ id: z.string(), code: z.string() }).nullable(),
    staff: z
      .object({ id: z.string(), firstName: z.string(), lastName: z.string() })
      .nullable()
      .meta({ description: "Who recorded it; null for the system." }),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "DriverTransaction" });

export type DriverTransaction = z.infer<typeof DriverTransaction>;

const nonZero = (value: string) => Number(value) !== 0;

// Staff record only payouts and adjustments; trip entries are written when a trip is completed.
export const RecordDriverTransaction = z
  .discriminatedUnion(
    "type",
    [
      z.object({
        type: z.literal("PAYOUT"),
        // What was paid to the driver; it lowers the balance by that much.
        amount: Amount.refine((value) => Number(value) > 0, "A payout must be more than zero."),
        note: Notes.optional(),
      }),
      z.object({
        type: z.literal("ADJUSTMENT"),
        // Signed: positive when the company owes the driver more.
        amount: Amount.refine(nonZero, "An adjustment can't be zero."),
        note: Text("Note", 500).meta({ description: "Why the balance is being corrected." }),
      }),
    ],
    { error: "Type must be PAYOUT or ADJUSTMENT." },
  )
  .meta({ id: "RecordDriverTransaction" });

export type RecordDriverTransaction = z.output<typeof RecordDriverTransaction>;

export const DriverTransactionRecorded = z
  .object({
    transaction: DriverTransaction,
    amountOwed: z.string().meta({ description: "The driver's balance after it." }),
  })
  .meta({ id: "DriverTransactionRecorded" });

export const ListDriverTransactions = z.object(PageQuery);

export type ListDriverTransactions = z.output<typeof ListDriverTransactions>;

// --- Vehicles ---

// Vehicle images: JPEG, PNG or WebP (checked from the bytes), up to 5 MB each and 5 per vehicle. The first is the cover.
export const vehicleImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const VEHICLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VEHICLE_IMAGE_LIMIT = 5;

export const VehicleImage = z
  .object({
    id: z.string(),
    position: z.int().meta({ description: "0 is the cover." }),
    url: z.string().meta({ description: "A signed link to the image, valid for 15 minutes." }),
  })
  .meta({ id: "VehicleImage" });

export const Vehicle = z
  .object({
    id: z.string(),
    make: z.string(),
    model: z.string(),
    year: z.int().nullable(),
    plateNumber: z.string(),
    color: z.string(),
    body: CarBody,
    isExternal: z.boolean(),
    office: OfficeSummary.nullable(),
    images: z.array(VehicleImage).meta({ description: "In order; the first is the cover." }),
    archivedAt: archived,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Vehicle" });

export type Vehicle = z.infer<typeof Vehicle>;

// Spaces collapsed and Latin letters in capitals, so the same plate always matches how it was stored.
const PlateNumber = Text("Plate number", 20)
  .transform((value) => value.replace(/\s+/g, " ").toUpperCase())
  .meta({ example: "ABC 1234" });

const VehicleFields = {
  make: Text("Make", 50),
  model: Text("Model", 50),
  year: z
    .int({ error: "Year must be a whole number." })
    .min(1980, "Year must be 1980 or later.")
    .max(2100, "Year must be 2100 or earlier.")
    .nullable(),
  plateNumber: PlateNumber,
  color: Text("Color", 30),
  body: CarBody,
  isExternal: z.boolean({ error: "External must be true or false." }),
  // Only an external vehicle can come from an office.
  officeId: Id("Office").nullable(),
};

export const CreateVehicle = z
  .object({
    ...VehicleFields,
    year: VehicleFields.year.optional(),
    isExternal: VehicleFields.isExternal.default(false),
    officeId: VehicleFields.officeId.optional(),
  })
  .meta({ id: "CreateVehicle" });

export type CreateVehicle = z.output<typeof CreateVehicle>;

export const UpdateVehicle = z.object(VehicleFields).partial().meta({ id: "UpdateVehicle" });

export type UpdateVehicle = z.output<typeof UpdateVehicle>;

export const ListVehicles = z.object({
  ...PageQuery,
  // Make, model, plate number or color.
  q: Search.optional(),
  body: CarBody.optional(),
  external: Flag("External").optional(),
  officeId: Id("Office").optional(),
  archived: Flag("Archived").default(false),
});

export type ListVehicles = z.output<typeof ListVehicles>;

// Every image of the vehicle, each once, in the new order.
export const ReorderVehicleImages = z
  .object({
    imageIds: z
      .array(Id("Image"))
      .min(1, "List the vehicle's images.")
      .max(VEHICLE_IMAGE_LIMIT, `A vehicle has ${VEHICLE_IMAGE_LIMIT} images at most.`)
      .refine((ids) => new Set(ids).size === ids.length, "Each image can only appear once."),
  })
  .meta({ id: "ReorderVehicleImages" });

export type ReorderVehicleImages = z.output<typeof ReorderVehicleImages>;

// --- Offices ---

export const OfficeLocation = z
  .object({
    id: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    locality: z.enum(["GOVERNORATE", "DISTRICT", "AREA"]),
  })
  .meta({ id: "OfficeLocation" });

export const Office = z
  .object({
    id: z.string(),
    name: z.string(),
    contact: z.string().meta({ description: "The person to talk to." }),
    phone: z.string(),
    email: z.string().nullable(),
    address: z.string(),
    location: OfficeLocation.nullable(),
    notes: z.string().nullable(),
    archivedAt: archived,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Office" });

export type Office = z.infer<typeof Office>;

export const OfficeDetail = Office.extend({
  drivers: z.array(Driver).meta({ description: "Its live drivers." }),
  vehicles: z.array(Vehicle).meta({ description: "Its live vehicles." }),
  trips: z
    .array(FleetTrip)
    .meta({ description: "Trips handed to it that are still live, soonest first (at most 100)." }),
}).meta({ id: "OfficeDetail" });

const OfficeFields = {
  name: Text("Name", 100),
  contact: Text("Contact", 100),
  phone: Phone,
  email: Email.nullable(),
  address: Text("Address", 200),
  // Where the office is, to find offices near a pickup. Must be a live location.
  locationId: Id("Location").nullable(),
  notes: Notes.nullable(),
};

export const CreateOffice = z
  .object({
    ...OfficeFields,
    email: OfficeFields.email.optional(),
    locationId: OfficeFields.locationId.optional(),
    notes: OfficeFields.notes.optional(),
  })
  .meta({ id: "CreateOffice" });

export type CreateOffice = z.output<typeof CreateOffice>;

export const UpdateOffice = z.object(OfficeFields).partial().meta({ id: "UpdateOffice" });

export type UpdateOffice = z.output<typeof UpdateOffice>;

export const ListOffices = z.object({
  ...PageQuery,
  // Name, contact, phone or email.
  q: Search.optional(),
  archived: Flag("Archived").default(false),
});

export type ListOffices = z.output<typeof ListOffices>;

export const NearbyOfficesQuery = z.object({
  latitude: z.coerce
    .number({ error: "Latitude must be a number." })
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  longitude: z.coerce
    .number({ error: "Longitude must be a number." })
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
});

export type NearbyOfficesQuery = z.output<typeof NearbyOfficesQuery>;

export const NearbyOffice = Office.extend({
  distanceMeters: z
    .int()
    .nullable()
    .meta({ description: "From the pin to the office location's center; null for a governorate." }),
}).meta({ id: "NearbyOffice" });

export const NearbyOffices = z
  .object({
    location: OfficeLocation.nullable().meta({
      description:
        "The most specific covered location the pin falls in; null when it's outside coverage.",
    }),
    data: z.array(NearbyOffice),
  })
  .meta({ id: "NearbyOffices" });
