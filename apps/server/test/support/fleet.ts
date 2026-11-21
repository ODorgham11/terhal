import type { Problem, StaffPermission, ValidationIssue } from "@terhal/contracts";
import { prisma } from "../../src/platform/db/prisma";
import { STAFF_PASSWORD, createStaff } from "./factories";
import { DASHBOARD_ORIGIN, createAgent } from "./http";

// A staff member holding these permissions, signed in to the dashboard.
export const signedInStaff = async (
  permissions: StaffPermission[] = ["fleet"],
  email = `${permissions.join("-") || "none"}@terhal.co`,
) => {
  const staff = await createStaff(email, permissions);
  const agent = createAgent(DASHBOARD_ORIGIN);
  const response = await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email, password: STAFF_PASSWORD },
  });
  if (response.status !== 200) throw new Error(`Couldn't sign in as ${email}.`);
  return { staff, agent };
};

export type Agent = Awaited<ReturnType<typeof signedInStaff>>["agent"];

// What an error response carries, with the extra members fleet routes add.
export type FleetProblem = Problem & {
  errors: ValidationIssue[];
  trips: { id: string; code: string }[];
};

export interface Page<Item> {
  data: Item[];
  nextCursor: string | null;
}

// The JSON body of a response, as the type it's expected to be (a problem unless told otherwise).
export const bodyOf = async <Body = FleetProblem>(response: Response) =>
  (await response.json()) as Body;

export const governorate = (nameEn: string, nameAr = `${nameEn} ar`) =>
  prisma.location.create({ data: { locality: "GOVERNORATE", nameEn, nameAr } });

// A district or an area: a circle around its center.
export const place = (
  parentId: string,
  locality: "DISTRICT" | "AREA",
  nameEn: string,
  latitude: number,
  longitude: number,
  radius = 5_000,
) =>
  prisma.location.create({
    data: {
      parentId,
      locality,
      nameEn,
      nameAr: `${nameEn} ar`,
      latitude: latitude.toFixed(6),
      longitude: longitude.toFixed(6),
      radius,
    },
  });

// A trip booked by a staff member, with whatever is assigned to it.
export const createTrip = async ({
  status = "CONFIRMED",
  driverId,
  vehicleId,
  officeId,
  pickupDate = new Date(Date.now() + 24 * 60 * 60 * 1000),
}: {
  status?: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "AWAITING_REPORT" | "COMPLETED" | "CANCELLED";
  driverId?: string;
  vehicleId?: string;
  officeId?: string;
  pickupDate?: Date;
}) => {
  const booker =
    (await prisma.staff.findFirst({ where: { email: "booker@terhal.co" } })) ??
    (await createStaff("booker@terhal.co", ["trips"]));
  const tripClass =
    (await prisma.tripClass.findFirst()) ??
    (await prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي" } }));
  const location =
    (await prisma.location.findFirst({ where: { nameEn: "Trip governorate" } })) ??
    (await governorate("Trip governorate"));

  return prisma.trip.create({
    data: {
      code: `TRH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      source: "STAFF",
      status,
      staffId: booker.id,
      driverId,
      vehicleId,
      officeId,
      classId: tripClass.id,
      classSnapshot: { nameEn: tripClass.nameEn, nameAr: tripClass.nameAr },
      clientName: "Client",
      clientPhone: "+201000000000",
      pickupDate,
      smallLuggage: 0,
      mediumLuggage: 0,
      largeLuggage: 0,
      passengers: 1,
      car: "SEDAN",
      totalPrice: "500.00",
      pickupId: location.id,
      pickupSnapshot: "Pickup",
      pickupLatitude: "30.000000",
      pickupLongitude: "31.000000",
      dropoffId: location.id,
      dropoffSnapshot: "Drop-off",
      dropoffLatitude: "30.100000",
      dropoffLongitude: "31.100000",
    },
  });
};
