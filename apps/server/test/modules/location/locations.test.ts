import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
import { createGovernorate, createPlace, squareAround } from "../../support/locations";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = ReturnType<typeof createAgent>;

const center = { latitude: 29.96, longitude: 31.25 };

const create = (agent: Agent, prefix: "admin" | "staff", json: Record<string, unknown>) =>
  agent.request(`/v1/${prefix}/locations`, { method: "POST", json });

const district = (parentId: string, nameEn: string, nameAr = `${nameEn} ع`) => ({
  locality: "DISTRICT",
  parentId,
  nameEn,
  nameAr,
  center,
});

const area = (parentId: string, nameEn: string, nameAr = `${nameEn} ع`) => ({
  ...district(parentId, nameEn, nameAr),
  locality: "AREA",
});

const codeOf = async (response: Response) => ((await response.json()) as { code: string }).code;

describe("creating a location", () => {
  it("lets an admin create a district, audited as theirs, with a default radius", async () => {
    const { agent, admin } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");

    const response = await create(agent, "admin", district(cairo.id, " Maadi ", "المعادي"));
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    expect(created).toMatchObject({
      parentId: cairo.id,
      locality: "DISTRICT",
      nameEn: "Maadi",
      nameAr: "المعادي",
      center: { ...center, radius: 10_000 },
      hasBoundary: false,
      deletedAt: null,
    });

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: auditActions.LOCATION_CREATED },
    });
    expect(log).toMatchObject({ adminId: admin.id, staffId: null, entityId: created.id });
  });

  it("lets staff with pricing create one, audited as theirs", async () => {
    const { agent, staff } = await signedInStaff(["pricing"]);
    const cairo = await createGovernorate("Cairo");

    const response = await create(agent, "staff", area(cairo.id, "Airport"));
    expect(response.status).toBe(201);
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: auditActions.LOCATION_CREATED },
    });
    expect(log).toMatchObject({ adminId: null, staffId: staff.id });
  });

  it("refuses staff without pricing, but lets any staff member read", async () => {
    const { agent } = await signedInStaff(["trips"]);
    const cairo = await createGovernorate("Cairo");

    const response = await create(agent, "staff", district(cairo.id, "Maadi"));
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");

    const { agent: reader } = await signedInStaff([]);
    expect((await reader.request("/v1/staff/locations")).status).toBe(200);
    expect((await reader.request(`/v1/staff/locations/${cairo.id}`)).status).toBe(200);
  });

  it("needs someone signed in", async () => {
    const anonymous = createAgent(DASHBOARD_ORIGIN);
    expect((await anonymous.request("/v1/staff/locations")).status).toBe(401);
    expect((await createAgent().request("/v1/admin/locations")).status).toBe(401);
  });

  it("never creates a governorate", async () => {
    const { agent } = await signedInAdmin();
    const response = await create(agent, "admin", {
      locality: "GOVERNORATE",
      nameEn: "Atlantis",
      nameAr: "أطلانطس",
    });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("VALIDATION_FAILED");
  });
});

describe("parent rules", () => {
  it("puts districts in governorates and areas in either", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    const degla = await createPlace(maadi.id, "AREA", "Degla");

    expect((await create(agent, "admin", area(cairo.id, "Airport"))).status).toBe(201);
    expect((await create(agent, "admin", area(maadi.id, "Sarayat"))).status).toBe(201);

    for (const body of [district(maadi.id, "Inner"), area(degla.id, "Corner")]) {
      const response = await create(agent, "admin", body);
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("LOCATION_PARENT_INVALID");
    }
  });

  it("refuses a missing or deleted parent", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    await prisma.location.update({
      where: { id: maadi.id },
      data: { deletedAt: new Date(), deletedWithId: maadi.id },
    });

    for (const parentId of ["nope", maadi.id]) {
      const response = await create(agent, "admin", area(parentId, "Degla"));
      expect(await codeOf(response)).toBe("LOCATION_PARENT_INVALID");
    }
  });

  it("moves a location to another valid parent, and not to an invalid one", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const giza = await createGovernorate("Giza");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    const dokki = await createPlace(giza.id, "DISTRICT", "Dokki");

    const moved = await agent.request(`/v1/admin/locations/${maadi.id}`, {
      method: "PATCH",
      json: { parentId: giza.id },
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ parentId: giza.id });

    const invalid = await agent.request(`/v1/admin/locations/${maadi.id}`, {
      method: "PATCH",
      json: { parentId: dokki.id },
    });
    expect(await codeOf(invalid)).toBe("LOCATION_PARENT_INVALID");
  });

  it("only renames a governorate", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const giza = await createGovernorate("Giza");

    const renamed = await agent.request(`/v1/admin/locations/${cairo.id}`, {
      method: "PATCH",
      json: { nameEn: "Greater Cairo" },
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ nameEn: "Greater Cairo", center: null });

    for (const json of [{ parentId: giza.id }, { center }]) {
      const response = await agent.request(`/v1/admin/locations/${cairo.id}`, {
        method: "PATCH",
        json,
      });
      expect(await codeOf(response)).toBe("GOVERNORATE_READ_ONLY");
    }
    const removed = await agent.request(`/v1/admin/locations/${cairo.id}?expectedCount=1`, {
      method: "DELETE",
    });
    expect(await codeOf(removed)).toBe("GOVERNORATE_READ_ONLY");
  });

  it("reshapes a district, keeping its radius unless given, and audits before and after", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi", { radius: 4000 });

    const response = await agent.request(`/v1/staff/locations/${maadi.id}`, {
      method: "PATCH",
      json: { center: { latitude: 29.95, longitude: 31.26 } },
    });
    expect(await response.json()).toMatchObject({
      center: { latitude: 29.95, longitude: 31.26, radius: 4000 },
    });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: auditActions.LOCATION_UPDATED },
    });
    expect(log.before).toMatchObject({ center: { latitude: 30, longitude: 31, radius: 4000 } });
    expect(log.after).toMatchObject({ center: { latitude: 29.95, longitude: 31.26 } });
  });
});

describe("names", () => {
  it("are unique among live siblings in each language, ignoring case and Arabic letter forms", async () => {
    const { agent } = await signedInAdmin();
    const alexandria = await createGovernorate("Alexandria");
    const giza = await createGovernorate("Giza");
    await createPlace(alexandria.id, "DISTRICT", "Sporting", {}, "الإسكندرية الجديدة");

    for (const body of [
      district(alexandria.id, "SPORTING", "سبورتنج"),
      district(alexandria.id, "Smouha", "الاسكندريه الجديده"),
    ]) {
      const response = await create(agent, "admin", body);
      expect(response.status).toBe(409);
      expect(await codeOf(response)).toBe("LOCATION_NAME_TAKEN");
    }

    expect((await create(agent, "admin", district(giza.id, "Sporting"))).status).toBe(201);
  });

  it("can't be renamed or moved onto a sibling's", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const giza = await createGovernorate("Giza");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    await createPlace(cairo.id, "DISTRICT", "Zamalek");
    await createPlace(giza.id, "DISTRICT", "Maadi", {}, "معادي الجيزة");

    const renamed = await agent.request(`/v1/admin/locations/${maadi.id}`, {
      method: "PATCH",
      json: { nameEn: "zamalek" },
    });
    expect(await codeOf(renamed)).toBe("LOCATION_NAME_TAKEN");

    const moved = await agent.request(`/v1/admin/locations/${maadi.id}`, {
      method: "PATCH",
      json: { parentId: giza.id },
    });
    expect(await codeOf(moved)).toBe("LOCATION_NAME_TAKEN");
  });

  it("are free again once the location holding them is deleted", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    await agent.request(`/v1/admin/locations/${maadi.id}?expectedCount=1`, { method: "DELETE" });

    expect((await create(agent, "admin", district(cairo.id, "Maadi"))).status).toBe(201);
  });
});

describe("deleting and restoring", () => {
  // Cairo > Maadi > (Degla, Sarayat), Cairo > Airport.
  const tree = async () => {
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    const degla = await createPlace(maadi.id, "AREA", "Degla");
    const sarayat = await createPlace(maadi.id, "AREA", "Sarayat");
    const airport = await createPlace(cairo.id, "AREA", "Airport");
    return { cairo, maadi, degla, sarayat, airport };
  };

  const remove = (agent: Agent, id: string, expectedCount: number) =>
    agent.request(`/v1/admin/locations/${id}?expectedCount=${String(expectedCount)}`, {
      method: "DELETE",
    });
  const restore = (agent: Agent, id: string) =>
    agent.request(`/v1/admin/locations/${id}/restore`, { method: "POST" });

  const states = async () =>
    Object.fromEntries(
      (await prisma.location.findMany({ select: { nameEn: true, deletedWithId: true } })).map(
        (row) => [row.nameEn, row.deletedWithId],
      ),
    );

  it("refuses a count that isn't the live subtree's size, and deletes nothing", async () => {
    const { agent } = await signedInAdmin();
    const { maadi } = await tree();

    const response = await remove(agent, maadi.id, 1);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "LOCATION_COUNT_MISMATCH", count: 3 });
    expect(await prisma.location.count({ where: { deletedAt: { not: null } } })).toBe(0);
  });

  it("deletes the whole live subtree with it, and restores exactly that", async () => {
    const { agent } = await signedInAdmin();
    const { maadi, degla, sarayat } = await tree();

    // Degla is deleted on its own first, so restoring Maadi must leave it deleted.
    expect(await (await remove(agent, degla.id, 1)).json()).toEqual({ count: 1 });

    const detail = (await (await agent.request(`/v1/admin/locations/${maadi.id}`)).json()) as {
      subtreeSize: number;
    };
    expect(detail.subtreeSize).toBe(2);

    expect(await (await remove(agent, maadi.id, 2)).json()).toEqual({ count: 2 });
    expect(await states()).toEqual({
      Cairo: null,
      Maadi: maadi.id,
      Degla: degla.id,
      Sarayat: maadi.id,
      Airport: null,
    });

    // Sarayat went with Maadi: only Maadi can bring it back.
    const child = await restore(agent, sarayat.id);
    expect(child.status).toBe(409);
    expect(await codeOf(child)).toBe("LOCATION_NOT_RESTORABLE");

    expect(await (await restore(agent, maadi.id)).json()).toEqual({ count: 2 });
    expect(await states()).toEqual({
      Cairo: null,
      Maadi: null,
      Degla: degla.id,
      Sarayat: null,
      Airport: null,
    });

    const logs = await prisma.auditLog.findMany({
      where: { action: { in: [auditActions.LOCATION_DELETED, auditActions.LOCATION_RESTORED] } },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((log) => log.after)).toEqual([
      { count: 1, locationIds: [degla.id] },
      { count: 2, locationIds: [maadi.id, sarayat.id] },
      { count: 2, locationIds: expect.arrayContaining([maadi.id, sarayat.id]) as unknown },
    ]);
  });

  it("can't delete what's already deleted, or change it", async () => {
    const { agent } = await signedInAdmin();
    const { airport } = await tree();
    await remove(agent, airport.id, 1);

    expect(await codeOf(await remove(agent, airport.id, 1))).toBe("LOCATION_DELETED");
    const renamed = await agent.request(`/v1/admin/locations/${airport.id}`, {
      method: "PATCH",
      json: { nameEn: "Cairo Airport" },
    });
    expect(await codeOf(renamed)).toBe("LOCATION_DELETED");
  });

  it("restores only under a live parent, and only while the name is free", async () => {
    const { agent } = await signedInAdmin();
    const { cairo, maadi, degla } = await tree();

    await remove(agent, degla.id, 1);
    await remove(agent, maadi.id, 2);
    const orphan = await restore(agent, degla.id);
    expect(await codeOf(orphan)).toBe("LOCATION_NOT_RESTORABLE");

    await restore(agent, maadi.id);
    await create(agent, "admin", area(maadi.id, "Degla"));
    const taken = await restore(agent, degla.id);
    expect(taken.status).toBe(409);
    expect(await codeOf(taken)).toBe("LOCATION_NAME_TAKEN");

    const live = await restore(agent, cairo.id);
    expect(await codeOf(live)).toBe("LOCATION_NOT_RESTORABLE");
  });

  it("is open to staff with pricing only", async () => {
    const { agent: trips } = await signedInStaff(["trips"]);
    const { agent: pricing } = await signedInStaff(["pricing"]);
    const { airport } = await tree();

    const refused = await trips.request(`/v1/staff/locations/${airport.id}?expectedCount=1`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(403);

    const deleted = await pricing.request(`/v1/staff/locations/${airport.id}?expectedCount=1`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const restored = await pricing.request(`/v1/staff/locations/${airport.id}/restore`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);
  });

  it("answers 404 for a location that doesn't exist", async () => {
    const { agent } = await signedInAdmin();
    expect((await remove(agent, "nope", 1)).status).toBe(404);
    expect((await restore(agent, "nope")).status).toBe(404);
    expect((await agent.request("/v1/admin/locations/nope")).status).toBe(404);
  });
});

describe("reading locations", () => {
  it("searches both names, normalized, and pages with a cursor", async () => {
    const { agent } = await signedInStaff(["trips"]);
    const alexandria = await createGovernorate("Alexandria", "الإسكندرية");
    await createGovernorate("Cairo", "القاهرة");
    for (const name of ["Agami", "Bahary", "Cleopatra"]) {
      await createPlace(alexandria.id, "DISTRICT", name);
    }

    const search = async (q: string) =>
      (
        (await (await agent.request(`/v1/staff/locations?q=${encodeURIComponent(q)}`)).json()) as {
          data: { nameEn: string }[];
        }
      ).data.map((row) => row.nameEn);
    expect(await search("الاسكندريه")).toEqual(["Alexandria"]);
    expect(await search("  CAIRO ")).toEqual(["Cairo"]);

    const first = (await (
      await agent.request(`/v1/staff/locations?parentId=${alexandria.id}&limit=2`)
    ).json()) as { data: { nameEn: string }[]; nextCursor: string };
    expect(first.data.map((row) => row.nameEn)).toEqual(["Agami", "Bahary"]);
    const second = (await (
      await agent.request(
        `/v1/staff/locations?parentId=${alexandria.id}&limit=2&cursor=${first.nextCursor}`,
      )
    ).json()) as { data: { nameEn: string }[]; nextCursor: string | null };
    expect(second.data.map((row) => row.nameEn)).toEqual(["Cleopatra"]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists deleted locations only when asked", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo");
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    await agent.request(`/v1/admin/locations/${maadi.id}?expectedCount=1`, { method: "DELETE" });

    const names = async (query: string) =>
      (
        (await (await agent.request(`/v1/admin/locations${query}`)).json()) as {
          data: { nameEn: string }[];
        }
      ).data.map((row) => row.nameEn);
    expect(await names("")).toEqual(["Cairo"]);
    expect(await names("?deleted=true")).toEqual(["Maadi"]);
  });

  it("details a location with its outline, ancestors and usage", async () => {
    const { agent } = await signedInAdmin();
    const cairo = await createGovernorate("Cairo", "القاهرة", squareAround(31, 30));
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    const degla = await createPlace(maadi.id, "AREA", "Degla");
    const economy = await prisma.tripClass.create({
      data: { nameEn: "Economy", nameAr: "اقتصادي" },
    });
    await prisma.pricing.create({
      data: { fromId: degla.id, toId: cairo.id, classId: economy.id, car: "SEDAN", price: "500" },
    });

    const governorate = await (await agent.request(`/v1/admin/locations/${cairo.id}`)).json();
    expect(governorate).toMatchObject({
      hasBoundary: true,
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [30.5, 29.5],
            [31.5, 29.5],
            [31.5, 30.5],
            [30.5, 30.5],
            [30.5, 29.5],
          ],
        ],
      },
      ancestors: [],
      subtreeSize: 3,
      usage: { pricing: 1, offices: 0, upcomingTrips: 0 },
    });

    const area = await (await agent.request(`/v1/admin/locations/${degla.id}`)).json();
    expect(area).toMatchObject({
      boundary: null,
      ancestors: [
        { id: cairo.id, nameEn: "Cairo" },
        { id: maadi.id, nameEn: "Maadi" },
      ],
      subtreeSize: 1,
      usage: { pricing: 1 },
    });
  });
});

describe("flexible governorates", () => {
  it("can be booked as a whole once turned on, and only governorates with an outline can be", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const alexandria = await createGovernorate(
      "Alexandria",
      "الإسكندرية",
      squareAround(29.9, 31.2),
    );
    const bare = await createGovernorate("Matrouh");
    const smouha = await createPlace(alexandria.id, "DISTRICT", "Smouha");

    const set = (id: string, flexible: boolean) =>
      agent.request(`/v1/staff/locations/${id}`, { method: "PATCH", json: { flexible } });

    const on = await set(alexandria.id, true);
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({
      flexible: true,
      pin: { latitude: 31.2, longitude: 29.9 },
    });

    for (const id of [bare.id, smouha.id]) {
      const refused = await set(id, true);
      expect(refused.status).toBe(409);
      expect(await codeOf(refused)).toBe("LOCATION_NOT_FLEXIBLE");
    }

    // The trip pickers list districts, areas and flexible governorates only.
    const bookable = (await (await agent.request("/v1/staff/locations?bookable=true")).json()) as {
      data: { nameEn: string; flexible: boolean }[];
    };
    expect(bookable.data.map((row) => row.nameEn)).toEqual(["Alexandria", "Smouha"]);

    await set(alexandria.id, false);
    const after = (await (await agent.request("/v1/staff/locations?bookable=true")).json()) as {
      data: { nameEn: string }[];
    };
    expect(after.data.map((row) => row.nameEn)).toEqual(["Smouha"]);
  });

  it("are held by the database: only governorates with an outline", async () => {
    const bare = await createGovernorate("Matrouh");
    await expect(
      prisma.location.update({ where: { id: bare.id }, data: { flexible: true } }),
    ).rejects.toThrow(/Location_flexible/);
  });
});
