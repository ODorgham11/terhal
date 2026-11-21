import { z } from "zod";
import { CarBody } from "./cars";
import { Phone } from "./fields";
import { Pin } from "./locations";
import { Price } from "./pricing";
import { TripEventAction } from "./trip-events";

// Trips: booking on the site and in the dashboard, the status lifecycle, price on request, assignment and linked return
// trips (docs/domain-api.md, sections B, T, A and R, and the price-on-request flow under Q3).

// --- Rules shared by the API and the site ---

// Customers and guests book at least 3 hours ahead, at most 90 days ahead, on a 15-minute grid (B2), in Cairo time.
export const BOOKING_LEAD_HOURS = 3;
export const BOOKING_HORIZON_DAYS = 90;
export const PICKUP_GRID_MINUTES = 15;

// At most this many pending trips per customer, or per guest email (B5). Staff are unlimited.
export const PENDING_TRIP_LIMIT = 3;

// Another live trip of the same driver or vehicle this close to the pickup is a soft conflict (A3).
export const ASSIGNMENT_CONFLICT_HOURS = 3;

// A confirmed or started trip still not ended this long after its pickup moves to awaiting report (T3 d).
export const OVERDUE_AFTER_HOURS = 12;

export const tripStatuses = [
  "PENDING",
  "CANCELLED",
  "CONFIRMED",
  "IN_PROGRESS",
  "AWAITING_REPORT",
  "COMPLETED",
] as const;
export const TripStatus = z.enum(tripStatuses, { error: "Unknown status." }).meta({
  id: "TripStatus",
});
export type TripStatus = z.infer<typeof TripStatus>;

export const tripPriceStates = ["QUOTED", "REQUESTED", "PROPOSED", "ACCEPTED"] as const;
export const TripPriceState = z.enum(tripPriceStates).meta({
  id: "TripPriceState",
  description:
    "QUOTED: priced at booking. REQUESTED: no price yet. PROPOSED: staff proposed one, waiting for the booker. ACCEPTED: the booker accepted it.",
});
export type TripPriceState = z.infer<typeof TripPriceState>;

export const paymentMethods = ["CASH_TO_DRIVER", "CASH_AT_OFFICE", "TRANSFER", "CARD"] as const;
export const PaymentMethod = z.enum(paymentMethods, { error: "Unknown payment method." }).meta({
  id: "PaymentMethod",
});

// Why staff cancel a trip (T7 a). OTHER needs a note.
export const cancelReasons = [
  "CUSTOMER_REQUEST",
  "NO_SHOW",
  "NO_VEHICLE",
  "DUPLICATE",
  "OTHER",
] as const;
export const CancelReason = z.enum(cancelReasons, { error: "Unknown reason." }).meta({
  id: "CancelReason",
});
export type CancelReason = z.infer<typeof CancelReason>;

// --- Fields ---

const Id = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must contain 100 characters at most.`);

const Count = (label: string, min: number) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${String(min)}.`)
    .max(50, `${label} must be 50 at most.`);

const PassengerName = z
  .string({ error: "Passenger name is required." })
  .trim()
  .min(2, "Passenger name must contain at least 2 letters.")
  .max(100, "Passenger name must contain 100 letters at most.");

const Notes = z.string().trim().max(500, "Notes must contain 500 characters at most.");

const Note = (label: string) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(500, `${label} must contain 500 characters at most.`);

const PickupDate = z.iso
  .datetime({ error: "Pickup time must be an ISO-8601 instant, e.g. 2026-12-01T08:00:00Z." })
  .meta({ example: "2026-12-01T08:00:00Z" });

const Load = {
  passengers: Count("Passengers", 1),
  largeLuggage: Count("Large luggage", 0).default(0),
  mediumLuggage: Count("Medium luggage", 0).default(0),
  smallLuggage: Count("Small luggage", 0).default(0),
};

// The key a client sends with a booking so a retry returns the first trip instead of booking twice (B9).
export const IdempotencyHeader = z.object({
  "idempotency-key": z
    .string({ error: "The Idempotency-Key header is required." })
    .trim()
    .min(8, "The Idempotency-Key header must contain at least 8 characters.")
    .max(100, "The Idempotency-Key header must contain 100 characters at most.")
    .meta({
      description:
        "A random value (a UUID, say) made once per booking attempt and sent again on every retry of it.",
      example: "9b2f4c1e-6a7d-4e1b-9c3f-2d8a5b7e0f11",
    }),
});

// --- Booking ---

const bookingFields = {
  classId: Id("Class"),
  car: CarBody,
  pickup: Pin,
  dropoff: Pin,
  pickupDate: PickupDate,
  ...Load,
  clientName: PassengerName.optional().meta({
    description: "The passenger's name. Defaults to the booker's.",
  }),
  clientPhone: Phone.optional().meta({
    description: "The passenger's phone. Defaults to the booker's.",
  }),
  notes: Notes.optional(),
};

const ReturnLeg = {
  pickupDate: PickupDate,
  pickup: Pin.optional().meta({ description: "Defaults to the outbound's drop-off." }),
  dropoff: Pin.optional().meta({ description: "Defaults to the outbound's pickup." }),
};

// A customer or a verified guest booking on the site (B1). `expectedPrice` is the price the quote showed: required for a
// priced option and left out for one without a price (booked on request).
export const BookTrip = z
  .object({
    ...bookingFields,
    expectedPrice: Price.optional().meta({
      description: "The quoted price. Leave it out for an option the quote showed without a price.",
    }),
    return: z
      .object({
        ...ReturnLeg,
        expectedPrice: Price.optional().meta({ description: "The quote's `returnPrice`." }),
      })
      .optional()
      .meta({
        description:
          "Also book the way back: a second trip with the same class, body, passengers and luggage, linked to this one.",
      }),
  })
  .meta({ id: "BookTrip" });
export type BookTrip = z.output<typeof BookTrip>;

// Staff booking in the dashboard (B6): for an existing customer (the booker is then the customer) or on their own (the
// staff member is the booker, and the trip must have a price). Staff set the price themselves or take the price list's.
export const StaffBookTrip = z
  .object({
    ...bookingFields,
    customerId: Id("Customer").optional().meta({
      description:
        "Book for this customer (found by phone or email in the customer list). Left out, the staff member is the booker.",
    }),
    totalPrice: Price.optional().meta({
      description:
        "The price to charge. Left out, the price list's; without one, a customer's trip is booked on request.",
    }),
    backdated: z.boolean({ error: "Backdated must be true or false." }).default(false).meta({
      description: "Needed for a pickup time in the past (recording a trip that already happened).",
    }),
    return: z
      .object({ ...ReturnLeg, totalPrice: Price.optional() })
      .optional()
      .meta({ description: "Also book the way back, linked to this one." }),
  })
  .meta({ id: "StaffBookTrip" });
export type StaffBookTrip = z.output<typeof StaffBookTrip>;

// --- What a trip looks like ---

export const TripPlace = z
  .object({
    id: z.string(),
    nameEn: z.string().meta({ description: "Its name when the trip was booked." }),
    nameAr: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  })
  .meta({ id: "TripPlace" });

const TripClassSnapshot = z
  .object({ id: z.string(), nameEn: z.string(), nameAr: z.string() })
  .meta({ id: "TripClassSnapshot", description: "The class as it was named at booking." });

const tripFields = {
  id: z.string(),
  code: z.string().meta({ example: "TRH-7K3Q9P" }),
  status: TripStatus,
  priceState: TripPriceState,
  totalPrice: z.string().nullable().meta({
    example: "1250.00",
    description: "EGP. Null while a price is requested.",
  }),
  clientName: z.string(),
  clientPhone: z.string(),
  class: TripClassSnapshot,
  car: CarBody,
  passengers: z.int(),
  largeLuggage: z.int(),
  mediumLuggage: z.int(),
  smallLuggage: z.int(),
  pickupDate: z.iso.datetime(),
  pickup: TripPlace,
  dropoff: TripPlace,
  notes: z.string().nullable(),
  previousTripId: z
    .string()
    .nullable()
    .meta({ description: "The outbound trip, when this one is its return." }),
  returnTripId: z
    .string()
    .nullable()
    .meta({ description: "The return trip, when this one has one." }),
  createdAt: z.iso.datetime(),
};

// What the customer sees of the assignment, once the trip is confirmed and assigned (A6 a).
export const SiteAssignment = z
  .object({
    driver: z.object({ firstName: z.string(), phone: z.string() }).nullable(),
    vehicle: z
      .object({ make: z.string(), model: z.string(), color: z.string(), plateNumber: z.string() })
      .nullable(),
    partner: z.boolean().meta({
      description:
        "Operated by a partner office. Its driver and vehicle are shown when they're recorded.",
    }),
  })
  .meta({ id: "SiteAssignment" });

export const SiteTrip = z
  .object({
    ...tripFields,
    assignment: SiteAssignment.nullable().meta({
      description: "Null until the trip is confirmed and assigned.",
    }),
  })
  .meta({ id: "SiteTrip" });
export type SiteTrip = z.infer<typeof SiteTrip>;

export const SiteBooking = z
  .object({ trip: SiteTrip, returnTrip: SiteTrip.nullable() })
  .meta({ id: "SiteBooking" });
export type SiteBooking = z.infer<typeof SiteBooking>;

// The trips an action on the site changed: a whole booking can be cancelled, or every proposed leg accepted, at once.
export const SiteTripsChanged = z
  .object({ data: z.array(SiteTrip).meta({ description: "The trips changed, outbound first." }) })
  .meta({ id: "SiteTripsChanged" });

export const TripBooker = z
  .object({
    type: z.enum(["CUSTOMER", "GUEST", "STAFF"]),
    id: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string(),
  })
  .meta({ id: "TripBooker" });

export const Trip = z
  .object({
    ...tripFields,
    source: z.enum(["CUSTOMER", "STAFF"]),
    booker: TripBooker,
    driver: z
      .object({ id: z.string(), firstName: z.string(), lastName: z.string(), phone: z.string() })
      .nullable(),
    vehicle: z
      .object({
        id: z.string(),
        make: z.string(),
        model: z.string(),
        color: z.string(),
        plateNumber: z.string(),
        body: CarBody,
      })
      .nullable(),
    office: z.object({ id: z.string(), name: z.string(), phone: z.string() }).nullable(),
    paymentMethod: PaymentMethod.nullable(),
    paidAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Trip" });
export type Trip = z.infer<typeof Trip>;

export const StaffBooking = z
  .object({ trip: Trip, returnTrip: Trip.nullable() })
  .meta({ id: "StaffBooking" });
export type StaffBooking = z.infer<typeof StaffBooking>;

export const TripEventActor = z
  .object({
    type: z.enum(["STAFF", "CUSTOMER", "GUEST", "SYSTEM"]),
    id: z.string().nullable(),
    name: z.string().meta({ description: "A person's name, or the job's for the system." }),
  })
  .meta({ id: "TripEventActor" });

export const TripEvent = z
  .object({
    id: z.string(),
    action: TripEventAction,
    actor: TripEventActor,
    data: z.record(z.string(), z.unknown()).nullable().meta({
      description:
        "`from` and `to` for a status change, `reason` and `note`, and `changes`: each changed field's `before` and `after`.",
    }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "TripEvent" });
export type TripEvent = z.infer<typeof TripEvent>;

export const TripReportSummary = z
  .object({
    startedAt: z.iso.datetime(),
    vehiclePickup: z.string(),
    startMileage: z.int(),
    pickupAt: z.iso.datetime(),
    dropoffAt: z.iso.datetime(),
    vehicleDropoff: z.string(),
    endedAt: z.iso.datetime(),
    endMileage: z.int(),
    expenses: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        amount: z.string(),
        notes: z.string().nullable(),
      }),
    ),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "TripReportSummary" });

export const TripLink = z
  .object({ id: z.string(), code: z.string(), status: TripStatus, pickupDate: z.iso.datetime() })
  .meta({ id: "TripLink" });

export const TripDetail = Trip.extend({
  events: z.array(TripEvent).meta({ description: "Oldest first." }),
  previousTrip: TripLink.nullable(),
  returnTrip: TripLink.nullable(),
  report: TripReportSummary.nullable(),
}).meta({ id: "TripDetail" });
export type TripDetail = z.infer<typeof TripDetail>;

// --- Lists ---

const Limit = z.coerce
  .number({ error: "Limit must be a number." })
  .int("Limit must be a whole number.")
  .min(1, "Limit must be at least 1.")
  .max(100, "Limit must be 100 at most.")
  .default(50);

const Cursor = Id("Cursor").meta({ description: "The previous page's nextCursor." });

const Flag = (label: string) =>
  z
    .enum(["true", "false"], { error: `${label} must be true or false.` })
    .transform((value) => value === "true");

export const ListSiteTrips = z.object({
  status: TripStatus.optional(),
  cursor: Cursor.optional(),
  limit: Limit,
});
export type ListSiteTrips = z.output<typeof ListSiteTrips>;

export const ListTrips = z.object({
  status: TripStatus.optional(),
  from: z.iso.datetime({ error: "From must be an ISO-8601 instant." }).optional().meta({
    description: "Pickups at or after this instant.",
  }),
  to: z.iso.datetime({ error: "To must be an ISO-8601 instant." }).optional().meta({
    description: "Pickups before this instant.",
  }),
  q: z.string().trim().max(100, "Search must contain 100 characters at most.").optional().meta({
    description: "Every word must match the code, the passenger's name or their phone.",
  }),
  driverId: Id("Driver").optional(),
  vehicleId: Id("Vehicle").optional(),
  officeId: Id("Office").optional(),
  unassigned: Flag("Unassigned").optional().meta({
    description:
      "Only pending or confirmed trips without an office and without a driver or a vehicle.",
  }),
  cursor: Cursor.optional(),
  limit: Limit,
});
export type ListTrips = z.output<typeof ListTrips>;

export const TripOverview = z
  .object({
    today: z.int().meta({ description: "Trips not cancelled picking up today (Cairo)." }),
    tomorrow: z.int(),
    unassigned: z.int().meta({ description: "Pending or confirmed, not assigned yet." }),
    inProgress: z.int(),
    awaitingReport: z.int(),
    overdue: z.int().meta({
      description: "Pending or confirmed trips whose pickup time has passed.",
    }),
    priceRequests: z.int().meta({ description: "Pending trips waiting for a price." }),
  })
  .meta({ id: "TripOverview" });
export type TripOverview = z.infer<typeof TripOverview>;

// --- Editing (B10 a) ---

// Only what's sent changes. Route, class and body changes don't reprice the trip: staff set totalPrice themselves.
export const UpdateTrip = z
  .object({
    pickupDate: PickupDate.optional(),
    pickup: Pin.optional(),
    dropoff: Pin.optional(),
    classId: Id("Class").optional(),
    car: CarBody.optional(),
    passengers: Count("Passengers", 1).optional(),
    largeLuggage: Count("Large luggage", 0).optional(),
    mediumLuggage: Count("Medium luggage", 0).optional(),
    smallLuggage: Count("Small luggage", 0).optional(),
    notes: Notes.nullable().optional(),
    clientName: PassengerName.optional(),
    clientPhone: Phone.optional(),
    totalPrice: Price.optional().meta({ description: "Editable until the trip is completed." }),
    paymentMethod: PaymentMethod.nullable().optional(),
    paidAt: z.iso.datetime({ error: "Paid at must be an ISO-8601 instant." }).nullable().optional(),
  })
  .refine((update) => Object.values(update).some((value) => value !== undefined), {
    message: "Send at least one field to change.",
  })
  .meta({ id: "UpdateTrip" });
export type UpdateTrip = z.output<typeof UpdateTrip>;

// --- Price on request ---

export const ProposePrice = z
  .object({
    totalPrice: Price,
    note: Note("Note").optional(),
    saveToPricing: z
      .boolean({ error: "Save to pricing must be true or false." })
      .default(false)
      .meta({ description: "Also save it to the price list for this route (needs `pricing`)." }),
  })
  .meta({ id: "ProposePrice" });
export type ProposePrice = z.output<typeof ProposePrice>;

export const AcceptPrice = z
  .object({
    expectedPrice: Price.meta({
      description:
        "The total of the proposals shown: every proposed leg of the booking is accepted together.",
    }),
  })
  .meta({ id: "AcceptPrice" });

export const DeclinePrice = z
  .object({ reason: Note("Reason").optional() })
  .meta({ id: "DeclinePrice" });

// --- Lifecycle ---

export const CancelTrip = z
  .object({ reason: CancelReason, note: Note("Note").optional() })
  .refine((body) => body.reason !== "OTHER" || body.note !== undefined, {
    message: "Say why in a note.",
    path: ["note"],
  })
  .meta({ id: "CancelTrip" });
export type CancelTrip = z.output<typeof CancelTrip>;

export const SiteCancelTrip = z
  .object({ reason: Note("Reason").optional() })
  .meta({ id: "SiteCancelTrip" });

// --- Assignment (A answers) ---

export const AssignTrip = z
  .object({
    driverId: Id("Driver").nullable().optional(),
    vehicleId: Id("Vehicle").nullable().optional(),
    officeId: Id("Office").nullable().optional(),
    acknowledgeConflicts: z
      .boolean({ error: "Acknowledge conflicts must be true or false." })
      .default(false)
      .meta({ description: "Assign even though the driver or vehicle has a trip close by." }),
  })
  .meta({
    id: "AssignTrip",
    description:
      "The whole assignment: what's left out or null is cleared. With an office, the driver and vehicle are optional and must come through it.",
  });
export type AssignTrip = z.output<typeof AssignTrip>;

export const TripConflict = z
  .object({
    id: z.string(),
    code: z.string(),
    status: TripStatus,
    pickupDate: z.iso.datetime(),
    driverId: z.string().nullable(),
    vehicleId: z.string().nullable(),
  })
  .meta({ id: "TripConflict" });
export type TripConflict = z.infer<typeof TripConflict>;

export const AssignmentCandidates = z
  .object({
    drivers: z.array(
      z.object({
        id: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        phone: z.string(),
        isExternal: z.boolean(),
        officeId: z.string().nullable(),
        conflicts: z.array(TripConflict),
      }),
    ),
    vehicles: z.array(
      z.object({
        id: z.string(),
        make: z.string(),
        model: z.string(),
        color: z.string(),
        plateNumber: z.string(),
        body: CarBody,
        isExternal: z.boolean(),
        officeId: z.string().nullable(),
        conflicts: z.array(TripConflict),
      }),
    ),
  })
  .meta({
    id: "AssignmentCandidates",
    description: `Live drivers, and live vehicles big enough for the trip, each with its live trips within ${String(ASSIGNMENT_CONFLICT_HOURS)} hours of the pickup.`,
  });
export type AssignmentCandidates = z.infer<typeof AssignmentCandidates>;

// --- Linking (R4 b) ---

export const LinkTrips = z
  .object({ returnTripId: Id("Return trip") })
  .meta({ id: "LinkTrips", description: "Make that trip this one's return." });
