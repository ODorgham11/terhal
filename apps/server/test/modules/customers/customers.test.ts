import { auditActions, type StaffPermission } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "../../../src/platform/crypto/passwords";
import { prisma } from "../../../src/platform/db/prisma";
import { signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { STAFF_PASSWORD, createStaff } from "../../support/factories";
import { DASHBOARD_ORIGIN, SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([resetDatabase(), resetRedis()]);
});

const PASSWORD = "Correct-horse-1";

type Agent = ReturnType<typeof createAgent>;

let customerCount = 0;
const createCustomer = async (
  overrides: Partial<{
    firstName: string;
    email: string;
    phone: string;
    status: "ACTIVE" | "UNVERIFIED";
  }> = {},
) => {
  customerCount += 1;
  const status = overrides.status ?? "ACTIVE";
  return prisma.customer.create({
    data: {
      firstName: "Mona",
      lastName: "Adel",
      email: `customer${String(customerCount)}@example.com`,
      phone: `+2010000000${String(customerCount).padStart(2, "0")}`,
      passwordHash: await hash(PASSWORD),
      verifiedAt: status === "ACTIVE" ? new Date() : null,
      ...overrides,
      status,
    },
  });
};

const staffAgent = async (permissions: StaffPermission[]) => {
  const email = `staff-${permissions.join("-") || "none"}@terhal.co`;
  await createStaff(email, permissions);
  const agent = createAgent(DASHBOARD_ORIGIN);
  await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email, password: STAFF_PASSWORD },
  });
  return agent;
};

const tripFactory = async () => {
  const [location, tripClass] = await Promise.all([
    prisma.location.create({
      data: { locality: "GOVERNORATE", nameEn: "Cairo", nameAr: "القاهرة" },
    }),
    prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي" } }),
  ]);
  let code = 0;
  return (
    customerId: string,
    {
      status = "PENDING",
      totalPrice = "100.00",
      daysAhead = 1,
    }: {
      status?: "PENDING" | "COMPLETED" | "CANCELLED";
      totalPrice?: string;
      daysAhead?: number;
    } = {},
  ) =>
    prisma.trip.create({
      data: {
        code: `TRH-${String(++code)}`,
        source: "CUSTOMER",
        status,
        customerId,
        classId: tripClass.id,
        classSnapshot: { nameEn: "Economy", nameAr: "اقتصادي" },
        clientName: "Mona Adel",
        clientPhone: "+201000000001",
        pickupDate: new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000),
        smallLuggage: 0,
        mediumLuggage: 0,
        largeLuggage: 0,
        passengers: 2,
        car: "SEDAN",
        totalPrice,
        pickupId: location.id,
        pickupSnapshot: "Cairo",
        pickupSnapshotAr: "Cairo",
        pickupLatitude: "30.044420",
        pickupLongitude: "31.235712",
        dropoffId: location.id,
        dropoffSnapshot: "Maadi",
        dropoffSnapshotAr: "Maadi",
        dropoffLatitude: "29.960000",
        dropoffLongitude: "31.250000",
      },
    });
};

const ids = async (response: Response) =>
  ((await response.json()) as { data: { id: string }[] }).data.map(({ id }) => id);

describe("customers in the dashboard", () => {
  it("are listed with the customers or trips permission", async () => {
    const customer = await createCustomer();

    for (const permissions of [["customers"], ["trips"]] as StaffPermission[][]) {
      const response = await (await staffAgent(permissions)).request("/v1/staff/customers");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: [
          expect.objectContaining({
            id: customer.id,
            email: customer.email,
            status: "ACTIVE",
            locale: "ar",
            verifiedAt: expect.any(String) as unknown,
          }),
        ],
        nextCursor: null,
      });
    }

    const fleet = await staffAgent(["fleet", "team"]);
    const refused = await fleet.request("/v1/staff/customers");
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("are searched by name, phone or email, however the Arabic is spelled", async () => {
    const agent = await staffAgent(["customers"]);
    const esraa = await createCustomer({ firstName: "إسراء", phone: "+201112223334" });
    const other = await createCustomer({ firstName: "Karim", email: "karim@example.com" });

    expect(
      await ids(await agent.request(`/v1/staff/customers?q=${encodeURIComponent("اسراء")}`)),
    ).toEqual([esraa.id]);
    expect(await ids(await agent.request("/v1/staff/customers?q=01112223334"))).toEqual([esraa.id]);
    expect(await ids(await agent.request("/v1/staff/customers?q=KARIM%40example"))).toEqual([
      other.id,
    ]);
    expect(await ids(await agent.request("/v1/staff/customers?q=karim%20adel"))).toEqual([
      other.id,
    ]);
  });

  it("are filtered by status and paged, and guests never appear", async () => {
    const agent = await staffAgent(["customers"]);
    const first = await createCustomer();
    const second = await createCustomer({ status: "UNVERIFIED" });
    const third = await createCustomer();
    await prisma.guestSession.create({
      data: {
        firstName: "Guest",
        lastName: "Person",
        phone: "+201999999999",
        email: "guest@example.com",
        tokenHash: "guest",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await ids(await agent.request("/v1/staff/customers?status=UNVERIFIED"))).toEqual([
      second.id,
    ]);

    const page1 = await agent.request("/v1/staff/customers?limit=2");
    const body1 = (await page1.json()) as { data: { id: string }[]; nextCursor: string };
    expect(body1.data.map(({ id }) => id)).toEqual([third.id, second.id]);
    expect(body1.nextCursor).toBe(second.id);

    const page2 = await agent.request(`/v1/staff/customers?limit=2&cursor=${body1.nextCursor}`);
    expect(await page2.json()).toEqual({
      data: [expect.objectContaining({ id: first.id })],
      nextCursor: null,
    });

    expect((await agent.request("/v1/staff/customers?status=GUEST")).status).toBe(400);
  });

  it("show their trip count and what their completed trips came to", async () => {
    const agent = await staffAgent(["customers"]);
    const customer = await createCustomer();
    const trip = await tripFactory();
    await trip(customer.id, { status: "COMPLETED", totalPrice: "100.00", daysAhead: -3 });
    await trip(customer.id, { status: "COMPLETED", totalPrice: "250.50", daysAhead: -2 });
    await trip(customer.id, { status: "CANCELLED", totalPrice: "999.00" });
    await trip(customer.id, { status: "PENDING", totalPrice: "80.00" });
    const someoneElse = await createCustomer();
    await trip(someoneElse.id, { status: "COMPLETED" });

    const response = await agent.request(`/v1/staff/customers/${customer.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: customer.id,
      tripCount: 4,
      totalSpent: "350.50",
    });

    const nobody = await createCustomer();
    expect(await (await agent.request(`/v1/staff/customers/${nobody.id}`)).json()).toMatchObject({
      tripCount: 0,
      totalSpent: "0.00",
    });

    expect((await agent.request("/v1/staff/customers/nope")).status).toBe(404);
  });

  it("show their trips, latest pickup first, paged and filtered", async () => {
    const agent = await staffAgent(["customers"]);
    const customer = await createCustomer();
    const trip = await tripFactory();
    const past = await trip(customer.id, { status: "COMPLETED", daysAhead: -5 });
    const soon = await trip(customer.id, { daysAhead: 1 });
    const later = await trip(customer.id, { daysAhead: 7 });

    const page1 = await agent.request(`/v1/staff/customers/${customer.id}/trips?limit=2`);
    const body1 = (await page1.json()) as { data: { id: string }[]; nextCursor: string };
    expect(body1.data.map(({ id }) => id)).toEqual([later.id, soon.id]);
    expect(body1.data[0]).toMatchObject({
      code: later.code,
      status: "PENDING",
      source: "CUSTOMER",
      pickup: "Cairo",
      dropoff: "Maadi",
      car: "SEDAN",
      passengers: 2,
      totalPrice: "100.00",
      priceState: "QUOTED",
    });

    const page2 = await agent.request(
      `/v1/staff/customers/${customer.id}/trips?limit=2&cursor=${body1.nextCursor}`,
    );
    expect(await ids(page2)).toEqual([past.id]);

    expect(
      await ids(await agent.request(`/v1/staff/customers/${customer.id}/trips?status=COMPLETED`)),
    ).toEqual([past.id]);
    expect((await agent.request("/v1/staff/customers/nope/trips")).status).toBe(404);
  });

  it("need the customers permission for details and trips", async () => {
    const agent = await staffAgent(["trips"]);
    const customer = await createCustomer();

    for (const path of [`/${customer.id}`, `/${customer.id}/trips`]) {
      const response = await agent.request(`/v1/staff/customers${path}`);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("can't be suspended by staff", async () => {
    const agent = await staffAgent(["customers", "team", "trips"]);
    const customer = await createCustomer();

    // There's no such route in the dashboard, and the admin panel's refuses the dashboard's origin.
    const dashboard = await agent.request(`/v1/staff/customers/${customer.id}/suspend`, {
      method: "POST",
      json: { reason: "Abusive calls" },
    });
    expect(dashboard.status).toBe(404);
    const adminRoute = await agent.request(`/v1/admin/customers/${customer.id}/suspend`, {
      method: "POST",
      json: { reason: "Abusive calls" },
    });
    expect(adminRoute.status).toBe(403);

    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe(
      "ACTIVE",
    );
  });
});

describe("customers in the admin panel", () => {
  const suspend = (agent: Agent, id: string, reason?: string) =>
    agent.request(`/v1/admin/customers/${id}/suspend`, {
      method: "POST",
      json: reason === undefined ? {} : { reason },
    });
  const reactivate = (agent: Agent, id: string, reason = "Spoke to them on the phone") =>
    agent.request(`/v1/admin/customers/${id}/reactivate`, { method: "POST", json: { reason } });

  const signInCustomer = async (email: string) => {
    const agent = createAgent(SITE_ORIGIN);
    const response = await agent.request("/v1/site/auth/sign-in", {
      method: "POST",
      json: { identifier: email, password: PASSWORD },
    });
    return { agent, response };
  };

  it("are listed, shown with their trips", async () => {
    const { agent } = await signedInAdmin();
    const customer = await createCustomer();
    const trip = await tripFactory();
    const booked = await trip(customer.id);

    expect(await ids(await agent.request("/v1/admin/customers"))).toEqual([customer.id]);
    expect(await (await agent.request(`/v1/admin/customers/${customer.id}`)).json()).toMatchObject({
      id: customer.id,
      tripCount: 1,
      totalSpent: "0.00",
    });
    expect(await ids(await agent.request(`/v1/admin/customers/${customer.id}/trips`))).toEqual([
      booked.id,
    ]);
  });

  it("suspending needs a reason, cuts their sessions at once and leaves their trips alone", async () => {
    const { admin, agent } = await signedInAdmin();
    const customer = await createCustomer();
    const trip = await tripFactory();
    const upcoming = await trip(customer.id, { daysAhead: 2 });
    const { agent: site } = await signInCustomer(customer.email);
    expect((await site.request("/v1/site/account")).status).toBe(200);

    const noReason = await suspend(agent, customer.id);
    expect(noReason.status).toBe(400);
    expect(await noReason.json()).toMatchObject({ code: "VALIDATION_FAILED" });

    expect((await suspend(agent, customer.id, "Repeated no-shows")).status).toBe(204);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe(
      "SUSPENDED",
    );

    // The same, unexpired access token no longer works, and they can't sign in again.
    expect((await site.request("/v1/site/account")).status).toBe(401);
    expect(await prisma.customerSession.count({ where: { revokedAt: null } })).toBe(0);
    expect(await (await signInCustomer(customer.email)).response.json()).toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });

    expect((await prisma.trip.findUniqueOrThrow({ where: { id: upcoming.id } })).status).toBe(
      "PENDING",
    );

    // Suspending again changes nothing.
    expect((await suspend(agent, customer.id, "Again")).status).toBe(204);

    expect((await reactivate(agent, customer.id)).status).toBe(204);
    expect((await signInCustomer(customer.email)).response.status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: customer.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, adminId: true, entityType: true, before: true, after: true },
    });
    expect(logs).toEqual([
      {
        action: auditActions.CUSTOMER_SUSPENDED,
        adminId: admin.id,
        entityType: "Customer",
        before: { status: "ACTIVE" },
        after: { status: "SUSPENDED", reason: "Repeated no-shows" },
      },
      {
        action: auditActions.CUSTOMER_REACTIVATED,
        adminId: admin.id,
        entityType: "Customer",
        before: { status: "SUSPENDED" },
        after: { status: "ACTIVE", reason: "Spoke to them on the phone" },
      },
    ]);
  });

  it("reactivating a customer who never verified leaves them unverified", async () => {
    const { agent } = await signedInAdmin();
    const customer = await createCustomer({ status: "UNVERIFIED" });

    await suspend(agent, customer.id, "Spam sign ups");
    await reactivate(agent, customer.id);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).status).toBe(
      "UNVERIFIED",
    );
  });

  it("refuses unknown and deleted customers", async () => {
    const { agent } = await signedInAdmin();
    expect((await suspend(agent, "nope", "Reason")).status).toBe(404);

    const customer = await createCustomer();
    await prisma.customer.update({ where: { id: customer.id }, data: { status: "DELETED" } });
    for (const response of [
      await suspend(agent, customer.id, "Reason"),
      await reactivate(agent, customer.id),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "ACCOUNT_DELETED" });
    }
  });
});
