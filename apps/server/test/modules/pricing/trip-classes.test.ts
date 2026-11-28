import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { createTrip, governorate } from "../../support/fleet";
import { DASHBOARD_ORIGIN, SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = ReturnType<typeof createAgent>;

const create = (agent: Agent, json: Record<string, unknown>) =>
  agent.request("/v1/staff/trip-classes", { method: "POST", json });

const codeOf = async (response: Response) => ((await response.json()) as { code: string }).code;

const economy = { nameEn: "Economy", nameAr: "اقتصادي" };

describe("trip classes", () => {
  it("are created with descriptions and an order by staff with pricing, audited", async () => {
    const { agent, staff } = await signedInStaff(["pricing"]);

    const response = await create(agent, {
      ...economy,
      descriptionEn: " Air conditioning ",
      descriptionAr: "",
      sortOrder: 2,
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    expect(created).toMatchObject({
      ...economy,
      descriptionEn: "Air conditioning",
      descriptionAr: null,
      sortOrder: 2,
      archivedAt: null,
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: auditActions.TRIP_CLASS_CREATED },
      }),
    ).toMatchObject({ staffId: staff.id, entityId: created.id });
  });

  it("are read with pricing or trips, and changed only with pricing", async () => {
    const { agent: trips } = await signedInStaff(["trips"]);
    const { agent: fleet } = await signedInStaff(["fleet"]);

    expect((await trips.request("/v1/staff/trip-classes")).status).toBe(200);
    expect((await fleet.request("/v1/staff/trip-classes")).status).toBe(403);
    expect((await create(trips, economy)).status).toBe(403);
    expect((await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/trip-classes")).status).toBe(
      401,
    );
  });

  it("have unique active names, ignoring case and Arabic letter forms", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    await create(agent, { nameEn: "VIP", nameAr: "كبار الشخصيات" });

    for (const body of [
      { nameEn: "vip", nameAr: "مميز" },
      { nameEn: "Premium", nameAr: "كبار الشخصيات" },
    ]) {
      const response = await create(agent, body);
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("TRIP_CLASS_NAME_TAKEN");
    }
  });

  it("are archived and restored, keeping their prices, unless the name was taken meanwhile", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { id } = (await (await create(agent, economy)).json()) as { id: string };
    const site = createAgent(SITE_ORIGIN);

    const archived = await agent.request(`/v1/staff/trip-classes/${id}/archive`, {
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { archivedAt: string | null }).archivedAt).not.toBeNull();
    expect(await (await site.request("/v1/site/trip-classes")).json()).toEqual({ data: [] });

    const listed = (await (await agent.request("/v1/staff/trip-classes?archived=true")).json()) as {
      data: { id: string }[];
    };
    expect(listed.data.map((row) => row.id)).toEqual([id]);

    const newer = await create(agent, economy);
    expect(newer.status).toBe(201);
    const refused = await agent.request(`/v1/staff/trip-classes/${id}/restore`, { method: "POST" });
    expect(await codeOf(refused)).toBe("TRIP_CLASS_NAME_TAKEN");

    await agent.request(`/v1/staff/trip-classes/${id}`, {
      method: "PATCH",
      json: { nameEn: "Economy (old)", nameAr: "اقتصادي قديم" },
    });
    const restored = await agent.request(`/v1/staff/trip-classes/${id}/restore`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { archivedAt: string | null }).archivedAt).toBeNull();
  });

  it("are updated with the change audited before and after", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { id } = (await (await create(agent, { ...economy, descriptionEn: "Basic" })).json()) as {
      id: string;
    };

    const response = await agent.request(`/v1/staff/trip-classes/${id}`, {
      method: "PATCH",
      json: { descriptionEn: "", sortOrder: 5 },
    });
    expect(await response.json()).toMatchObject({ descriptionEn: null, sortOrder: 5, ...economy });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: auditActions.TRIP_CLASS_UPDATED },
    });
    expect(log.before).toMatchObject({ descriptionEn: "Basic", sortOrder: 0 });
    expect(log.after).toMatchObject({ descriptionEn: null, sortOrder: 5 });

    const empty = await agent.request(`/v1/staff/trip-classes/${id}`, {
      method: "PATCH",
      json: {},
    });
    expect(empty.status).toBe(400);
    const missing = await agent.request("/v1/staff/trip-classes/nope", {
      method: "PATCH",
      json: { sortOrder: 1 },
    });
    expect(missing.status).toBe(404);
  });

  it("are listed for the site in order, active only, without signing in", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    await create(agent, { nameEn: "VIP", nameAr: "كبار", sortOrder: 2 });
    await create(agent, { ...economy, sortOrder: 1 });

    const response = await createAgent(SITE_ORIGIN).request("/v1/site/trip-classes");
    expect(response.status).toBe(200);
    const { data } = (await response.json()) as { data: { nameEn: string }[] };
    expect(data.map((row) => row.nameEn)).toEqual(["Economy", "VIP"]);
    expect(data[0]).not.toHaveProperty("archivedAt");
  });

  it("are listed for staff with their price rows and this month's trips", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const tripClass = await prisma.tripClass.create({ data: economy });
    const [cairo, giza] = await Promise.all([governorate("Cairo"), governorate("Giza")]);
    await prisma.pricing.create({
      data: {
        fromId: cairo.id,
        toId: giza.id,
        classId: tripClass.id,
        car: "SEDAN",
        price: "900.00",
      },
    });
    const now = new Date();
    await createTrip({ pickupDate: now });
    await createTrip({ pickupDate: now, status: "CANCELLED" });

    const response = await agent.request("/v1/staff/trip-classes");
    const { data } = (await response.json()) as {
      data: { prices: number; tripsThisMonth: number }[];
    };
    expect(data).toMatchObject([{ prices: 1, tripsThisMonth: 1 }]);
  });
});
