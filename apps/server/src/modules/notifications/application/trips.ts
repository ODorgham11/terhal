import type { Locale } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { env } from "../../../platform/config/env";
import type { TripFacts } from "../domain/rules";
import type { AssignmentDetails, NoticeData } from "../domain/templates";

// The trip as notifications see it: what the rules decide on, what the templates are filled with, and who booked it.
// Read straight from the trips, customers and fleet tables, read-only, so nothing in trips depends back on this module.

export type Db = Prisma.TransactionClient;

export type Recipient =
  | { customerId: string; email: string; locale: Locale; name: string }
  | { guestSessionId: string; email: string; locale: Locale; name: string };

export interface NotifiableTrip {
  id: string;
  facts: TripFacts;
  data: NoticeData;
  booker: Recipient | null;
}

const select = {
  id: true,
  code: true,
  status: true,
  priceState: true,
  source: true,
  totalPrice: true,
  pickupDate: true,
  clientName: true,
  pickupSnapshot: true,
  pickupSnapshotAr: true,
  dropoffSnapshot: true,
  dropoffSnapshotAr: true,
  staffId: true,
  driverId: true,
  vehicleId: true,
  officeId: true,
  customer: { select: { id: true, email: true, firstName: true, locale: true } },
  guestSession: { select: { id: true, email: true, firstName: true, locale: true } },
  driver: { select: { firstName: true, phone: true } },
  vehicle: { select: { make: true, model: true, color: true, plateNumber: true } },
} satisfies Prisma.TripSelect;

type Row = Prisma.TripGetPayload<{ select: typeof select }>;

// A6 a: once confirmed and assigned, the driver's first name and phone and the vehicle; an office trip with neither
// recorded is "operated by a partner".
const assignment = (trip: Row): AssignmentDetails | null => {
  const confirmed = trip.status !== "PENDING" && trip.status !== "CANCELLED";
  if (!confirmed || (!trip.driver && !trip.vehicle && !trip.officeId)) return null;
  return {
    driverName: trip.driver?.firstName ?? null,
    driverPhone: trip.driver?.phone ?? null,
    vehicle: trip.vehicle && {
      make: trip.vehicle.make,
      model: trip.vehicle.model,
      color: trip.vehicle.color,
      plate: trip.vehicle.plateNumber,
    },
    partner: trip.officeId !== null,
  };
};

const bookerOf = (trip: Row): Recipient | null => {
  if (trip.customer) {
    const { id, email, firstName, locale } = trip.customer;
    return { customerId: id, email, locale, name: firstName };
  }
  if (trip.guestSession) {
    const { id, email, firstName, locale } = trip.guestSession;
    return { guestSessionId: id, email, locale, name: firstName };
  }
  return null;
};

export const tripLink = (tripId: string) => `${env.SITE_URL}/trips/${tripId}`;

export const loadTrip = async (db: Db, tripId: string): Promise<NotifiableTrip | null> => {
  const trip = await db.trip.findUnique({ where: { id: tripId }, select });
  if (!trip) return null;
  const booker = bookerOf(trip);
  return {
    id: trip.id,
    booker,
    facts: {
      status: trip.status,
      priceState: trip.priceState,
      source: trip.source,
      booker: trip.customer ? "customer" : trip.guestSession ? "guest" : "staff",
      pickupDate: trip.pickupDate,
      hasDriver: trip.driverId !== null,
      hasVehicle: trip.vehicleId !== null,
      hasOffice: trip.officeId !== null,
    },
    data: {
      tripId: trip.id,
      code: trip.code,
      name: booker?.name ?? null,
      client: trip.clientName,
      pickupAt: trip.pickupDate.toISOString(),
      pickup: { en: trip.pickupSnapshot, ar: trip.pickupSnapshotAr },
      dropoff: { en: trip.dropoffSnapshot, ar: trip.dropoffSnapshotAr },
      price: trip.totalPrice?.toFixed(2) ?? null,
      assignment: assignment(trip),
      link: booker ? tripLink(trip.id) : null,
    },
  };
};
