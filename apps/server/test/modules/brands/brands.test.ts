import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliver } from "../../../src/modules/notifications/application/delivery";
import { reportLinkMessage } from "../../../src/modules/trips/domain/report";
import { prisma } from "../../../src/platform/db/prisma";
import { sendEmail } from "../../../src/platform/email/email";
import { resetDatabase } from "../../support/database";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";
import {
  bookedTrip,
  json,
  pickupIn,
  pins,
  signedInCustomer,
  staffBook,
  tripWorld,
  tripsStaff,
  type Agent,
  type Booked,
  type TripWorld,
} from "../../support/trips";

vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.mocked(sendEmail).mockReset();
  await Promise.all([resetDatabase(), resetRedis()]);
});

interface BrandBody {
  id: string;
  isDefault: boolean;
  archivedAt: string | null;
  [key: string]: unknown;
}

const alex = {
  nameEn: "Alex Limousine",
  nameAr: "أليكس ليموزين",
  senderEmail: "Reservations@AlexLimousine.com",
  replyTo: "info@alexlimousine.com",
  phone: "0122 000 5678",
  website: "alexlimousine.com",
};

const create = (agent: Agent, body: Record<string, unknown>) =>
  agent.request("/v1/staff/brands", { method: "POST", json: body });

const created = async (agent: Agent, body: Record<string, unknown> = alex) => {
  const response = await create(agent, body);
  if (response.status !== 201) throw new Error(`${response.status} ${await response.text()}`);
  return json<BrandBody>(response);
};

const patch = (agent: Agent, path: string, body: unknown) =>
  agent.request(path, { method: "PATCH", json: body });

const post = (agent: Agent, path: string) => agent.request(path, { method: "POST" });

const codeOf = async (response: Response) => (await json<{ code: string }>(response)).code;

describe("brands", () => {
  it("are added by staff with team, cleaned up and audited", async () => {
    const { agent, staff } = await tripsStaff(["team"]);
    const brand = await created(agent);
    expect(brand).toMatchObject({
      nameEn: "Alex Limousine",
      senderEmail: "reservations@alexlimousine.com",
      phone: "+201220005678",
      isDefault: false,
      archivedAt: null,
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: auditActions.BRAND_CREATED } }),
    ).toMatchObject({ staffId: staff.id, entityType: "Brand", entityId: brand.id });

    // Empty text clears an optional field.
    const cleared = await patch(agent, `/v1/staff/brands/${brand.id}`, { website: "" });
    expect(await json(cleared)).toMatchObject({ website: null, phone: "+201220005678" });
  });

  it("are read with team or trips, and changed only with team", async () => {
    const { agent: trips } = await tripsStaff(["trips"]);
    const { agent: fleet } = await tripsStaff(["fleet"]);

    expect((await trips.request("/v1/staff/brands")).status).toBe(200);
    expect((await fleet.request("/v1/staff/brands")).status).toBe(403);
    expect((await create(trips, alex)).status).toBe(403);
    expect((await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/brands")).status).toBe(401);
  });

  it("have unique active names and need a valid sender address", async () => {
    const { agent } = await tripsStaff(["team"]);
    await created(agent);

    const taken = await create(agent, { ...alex, nameEn: "ALEX LIMOUSINE", nameAr: "ليموزين" });
    expect(taken.status).toBe(409);
    expect(await codeOf(taken)).toBe("BRAND_NAME_TAKEN");

    const bad = await create(agent, { ...alex, nameEn: "Other", nameAr: "أخرى", senderEmail: "x" });
    expect(bad.status).toBe(400);
  });

  it("have one default at most, and an archived brand is never it", async () => {
    const { agent } = await tripsStaff(["team"]);
    const first = await created(agent, { ...alex, isDefault: true });
    const second = await created(agent, {
      ...alex,
      nameEn: "Cairo Cars",
      nameAr: "كايرو كارز",
      isDefault: true,
    });

    const list = await json<{ data: BrandBody[] }>(await agent.request("/v1/staff/brands"));
    expect(list.data.map((brand) => [brand.id, brand.isDefault])).toEqual([
      [first.id, false],
      [second.id, true],
    ]);

    const archived = await json<BrandBody>(
      await post(agent, `/v1/staff/brands/${second.id}/archive`),
    );
    expect(archived).toMatchObject({ isDefault: false });
    expect(archived.archivedAt).not.toBeNull();

    const refused = await patch(agent, `/v1/staff/brands/${second.id}`, { isDefault: true });
    expect(refused.status).toBe(400);

    const archivedList = await json<{ data: BrandBody[] }>(
      await agent.request("/v1/staff/brands?archived=true"),
    );
    expect(archivedList.data.map((brand) => brand.id)).toEqual([second.id]);
    expect((await post(agent, `/v1/staff/brands/${second.id}/restore`)).status).toBe(200);
  });
});

describe("a trip's brand", () => {
  let world: TripWorld;
  let staff: Agent;
  beforeEach(async () => {
    world = await tripWorld();
    staff = (await tripsStaff(["trips", "team"])).agent;
  });

  const staffBooking = (overrides: Record<string, unknown> = {}) => ({
    classId: world.economy.id,
    car: "SEDAN",
    pickup: pins.degla,
    dropoff: pins.smouha,
    pickupDate: pickupIn(24).toISOString(),
    passengers: 2,
    clientName: "Walk In",
    clientPhone: "01001112223",
    ...overrides,
  });

  const booked = async (overrides: Record<string, unknown> = {}) => {
    const response = await staffBook(staff, staffBooking(overrides));
    if (response.status !== 201) throw new Error(`${response.status} ${await response.text()}`);
    return json<Booked>(response);
  };

  it("is the one staff pick, the default when they pick none, and Terhal for null", async () => {
    const brand = await created(staff);
    const brandOf = { id: brand.id, nameEn: "Alex Limousine", nameAr: "أليكس ليموزين" };

    // No default: Terhal.
    expect((await booked()).trip.brand).toBeNull();

    // Picked, for both legs.
    const both = await booked({
      brandId: brand.id,
      return: { pickupDate: pickupIn(30).toISOString() },
    });
    expect(both.trip.brand).toEqual(brandOf);
    expect(both.returnTrip?.brand).toEqual(brandOf);

    await patch(staff, `/v1/staff/brands/${brand.id}`, { isDefault: true });
    expect((await booked()).trip.brand).toEqual(brandOf);
    expect((await booked({ brandId: null })).trip.brand).toBeNull();
  });

  it("can't be an archived brand", async () => {
    const brand = await created(staff);
    await post(staff, `/v1/staff/brands/${brand.id}/archive`);
    const response = await staffBook(staff, staffBooking({ brandId: brand.id }));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("VALIDATION_FAILED");
  });

  it("changes on a staff booking, recorded, but never on a site booking", async () => {
    const brand = await created(staff);
    const { trip } = await booked();

    const changed = await patch(staff, `/v1/staff/trips/${trip.id}`, { brandId: brand.id });
    expect(changed.status).toBe(200);
    expect(await json(changed)).toMatchObject({ brand: { id: brand.id } });
    const event = await prisma.tripEvent.findFirstOrThrow({
      where: { tripId: trip.id, action: "trip.updated" },
    });
    expect(JSON.stringify(event.data)).toContain(brand.id);

    const { agent: site } = await signedInCustomer();
    const siteTrip = (await bookedTrip(site, world)).trip;
    const refused = await patch(staff, `/v1/staff/trips/${siteTrip.id}`, { brandId: brand.id });
    expect(refused.status).toBe(400);
  });

  it("sends the booker's emails from the brand, with its name and contacts", async () => {
    vi.mocked(sendEmail).mockResolvedValue("resend-id");
    const brand = await created(staff);
    const { customer } = await signedInCustomer();
    await booked({
      brandId: brand.id,
      customerId: customer.id,
      clientName: undefined,
      clientPhone: undefined,
    });

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { recipient: customer.email },
    });
    expect(await deliver(delivery.id, { final: true })).toBe("sent");
    const [, , , options] = vi.mocked(sendEmail).mock.calls[0] ?? [];
    expect(options).toMatchObject({
      from: "Alex Limousine <reservations@alexlimousine.com>",
      replyTo: "info@alexlimousine.com",
    });
    expect(options?.html).toContain("أليكس ليموزين");
    expect(options?.html).toContain("+201220005678");
  });

  it("sends Terhal's emails from the default address", async () => {
    vi.mocked(sendEmail).mockResolvedValue("resend-id");
    const { customer } = await signedInCustomer();
    await booked({ customerId: customer.id, clientName: undefined, clientPhone: undefined });

    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { recipient: customer.email },
    });
    await deliver(delivery.id, { final: true });
    const [, , , options] = vi.mocked(sendEmail).mock.calls[0] ?? [];
    expect(options?.from).toBeUndefined();
    expect(options?.html).toContain("ترحال");
  });
});

describe("the driver's WhatsApp message", () => {
  const base = {
    firstName: "Mostafa",
    code: "TRH-2BW7RN",
    pickupDate: new Date("2026-11-26T06:00:00Z"),
    url: "https://terhal.co/report#t",
  };

  it("comes from Terhal without a brand", () => {
    expect(reportLinkMessage(base, "en")).toMatch(/^Hi Mostafa, this is Terhal\. /);
  });

  it("comes from the brand, signed off with its phone", () => {
    const brand = { nameEn: "Alex Limousine", nameAr: "أليكس ليموزين", phone: "+201220005678" };
    expect(reportLinkMessage({ ...base, brand }, "en")).toMatch(
      /^Hi Mostafa, this is Alex Limousine\. [\s\S]*\n— Alex Limousine · \+201220005678$/,
    );
    expect(reportLinkMessage({ ...base, brand }, "ar")).toContain("معك أليكس ليموزين");
  });
});
