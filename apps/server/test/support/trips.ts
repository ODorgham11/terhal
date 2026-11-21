import type { StaffPermission } from "@terhal/contracts";
import { randomUUID } from "node:crypto";
import { hash } from "../../src/platform/crypto/passwords";
import { generateToken, hashToken } from "../../src/platform/crypto/tokens";
import { prisma } from "../../src/platform/db/prisma";
import { SITE_ORIGIN, createAgent } from "./http";
import { createGovernorate, createPlace, squareAround } from "./locations";
import { signedInStaff } from "./staff-agents";

// What the trip tests share: a small map with prices, signed in bookers, and a way to book.

export type Agent = ReturnType<typeof createAgent>;

// Cairo (an outline around 31.25, 30) holds Maadi (a district) holding Degla (an area); Alexandria (an outline around
// 29.9, 31.2) holds Smouha (an area directly in it).
export const pins = {
  degla: { latitude: 29.96, longitude: 31.26 },
  maadiOnly: { latitude: 29.99, longitude: 31.26 },
  cairoOnly: { latitude: 30.3, longitude: 31.5 },
  smouha: { latitude: 31.2, longitude: 29.95 },
  alexandriaOnly: { latitude: 31.5, longitude: 29.6 },
  sea: { latitude: 33, longitude: 33 },
};

// The map, two classes, and prices both ways between Degla and Smouha for an Economy sedan (1500 out, 1400 back).
export const tripWorld = async () => {
  const cairo = await createGovernorate("Cairo", "القاهرة", squareAround(31.25, 30));
  const alexandria = await createGovernorate("Alexandria", "الإسكندرية", squareAround(29.9, 31.2));
  const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi", {
    latitude: 29.97,
    longitude: 31.26,
    radius: 4000,
  });
  const degla = await createPlace(
    maadi.id,
    "AREA",
    "Degla",
    { latitude: 29.96, longitude: 31.26, radius: 1000 },
    "دجلة",
  );
  const smouha = await createPlace(
    alexandria.id,
    "AREA",
    "Smouha",
    { latitude: 31.2, longitude: 29.95, radius: 2000 },
    "سموحة",
  );
  const economy = await prisma.tripClass.create({
    data: { nameEn: "Economy", nameAr: "اقتصادي", sortOrder: 1 },
  });
  const vip = await prisma.tripClass.create({
    data: { nameEn: "VIP", nameAr: "كبار", sortOrder: 2 },
  });
  await prisma.pricing.createMany({
    data: [
      { fromId: degla.id, toId: smouha.id, classId: economy.id, car: "SEDAN", price: "1500" },
      { fromId: smouha.id, toId: degla.id, classId: economy.id, car: "SEDAN", price: "1400" },
    ],
  });
  return { cairo, alexandria, maadi, degla, smouha, economy, vip };
};

export type TripWorld = Awaited<ReturnType<typeof tripWorld>>;

const HOUR = 60 * 60 * 1000;

// A pickup `hours` from now, on the 15-minute grid (rounded up).
export const pickupIn = (hours: number) => {
  const quarter = 15 * 60 * 1000;
  return new Date(Math.ceil((Date.now() + hours * HOUR) / quarter) * quarter);
};

export const PASSWORD = "Correct-horse-1";

let customers = 0;

// An active customer, signed in on the site.
export const signedInCustomer = async (email?: string) => {
  customers += 1;
  const customer = await prisma.customer.create({
    data: {
      firstName: "Mona",
      lastName: "Adel",
      email: email ?? `customer${String(customers)}@example.com`,
      phone: `+2010100000${String(customers).padStart(2, "0")}`,
      passwordHash: await hash(PASSWORD),
      status: "ACTIVE",
      verifiedAt: new Date(),
    },
  });
  const agent = createAgent(SITE_ORIGIN);
  const response = await agent.request("/v1/site/auth/sign-in", {
    method: "POST",
    json: { identifier: customer.email, password: PASSWORD },
  });
  if (response.status !== 200) throw new Error("Couldn't sign the customer in.");
  return { customer, agent };
};

// A guest session, verified unless told otherwise, held by a new agent.
export const verifiedGuest = async (email = "guest@example.com", verified = true) => {
  const token = generateToken();
  const session = await prisma.guestSession.create({
    data: {
      firstName: "Karim",
      lastName: "Fathy",
      phone: "+201112345678",
      email,
      tokenHash: hashToken(token),
      verifiedAt: verified ? new Date() : null,
      expiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    },
  });
  const agent = createAgent(SITE_ORIGIN);
  agent.jar.set("guest_session", token);
  return { session, agent };
};

export const tripsStaff = (permissions: StaffPermission[] = ["trips"], email?: string) =>
  signedInStaff(permissions, email);

// A booking request as the site sends it: Degla to Smouha in an Economy sedan, a day ahead, at the quoted price.
export const booking = (world: TripWorld, overrides: Record<string, unknown> = {}) => ({
  classId: world.economy.id,
  car: "SEDAN",
  pickup: pins.degla,
  dropoff: pins.smouha,
  pickupDate: pickupIn(24).toISOString(),
  passengers: 2,
  expectedPrice: "1500.00",
  ...overrides,
});

export const book = (agent: Agent, json: unknown, key: string = randomUUID()) =>
  agent.request("/v1/site/trips", {
    method: "POST",
    json,
    headers: { "Idempotency-Key": key },
  });

export const staffBook = (agent: Agent, json: unknown, key: string = randomUUID()) =>
  agent.request("/v1/staff/trips", {
    method: "POST",
    json,
    headers: { "Idempotency-Key": key },
  });

export interface TripBody {
  id: string;
  code: string;
  status: string;
  priceState: string;
  totalPrice: string | null;
  previousTripId: string | null;
  returnTripId: string | null;
  clientName: string;
  clientPhone: string;
  pickupDate: string;
  pickup: { id: string; nameEn: string; nameAr: string };
  dropoff: { id: string; nameEn: string; nameAr: string };
  assignment?: unknown;
  [key: string]: unknown;
}

export interface Booked {
  trip: TripBody;
  returnTrip: TripBody | null;
}

export const json = async <Body = Record<string, unknown>>(response: Response) =>
  (await response.json()) as Body;

// A trip booked by a customer through the site, returned as the site shows it.
export const bookedTrip = async (agent: Agent, world: TripWorld, overrides = {}) => {
  const response = await book(agent, booking(world, overrides));
  if (response.status !== 201) {
    throw new Error(`Booking failed: ${response.status} ${await response.text()}`);
  }
  return json<Booked>(response);
};

// Posts to a staff trip action, e.g. "confirm".
export const act = (agent: Agent, tripId: string, action: string, body?: unknown) =>
  agent.request(`/v1/staff/trips/${tripId}/${action}`, {
    method: "POST",
    ...(body !== undefined && { json: body }),
  });

export const events = (tripId: string) =>
  prisma.tripEvent.findMany({ where: { tripId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

// A driver and a vehicle, written straight to the database.
let fleetCount = 0;
export const fleet = async ({
  body = "SEDAN",
  officeId,
}: { body?: "SEDAN" | "SUV" | "MINIVAN" | "VAN"; officeId?: string } = {}) => {
  fleetCount += 1;
  const n = String(fleetCount).padStart(3, "0");
  const external = officeId !== undefined;
  const driver = await prisma.driver.create({
    data: {
      firstName: `Driver${n}`,
      lastName: "Test",
      phone: `+20122000${n}`,
      isExternal: external,
      officeId,
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      make: "Toyota",
      model: "Corolla",
      plateNumber: `PLT ${n}`,
      color: "White",
      body,
      isExternal: external,
      officeId,
    },
  });
  return { driver, vehicle };
};
