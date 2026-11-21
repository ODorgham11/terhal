import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import type { createAgent } from "../../support/http";
import { createGovernorate, createPlace } from "../../support/locations";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = ReturnType<typeof createAgent>;

const codeOf = async (response: Response) => ((await response.json()) as { code: string }).code;

const world = async () => {
  const cairo = await createGovernorate("Cairo", "القاهرة");
  const alexandria = await createGovernorate("Alexandria", "الإسكندرية");
  const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi", {}, "المعادي");
  const degla = await createPlace(maadi.id, "AREA", "Degla", {}, "دجلة");
  const economy = await prisma.tripClass.create({ data: { nameEn: "Economy", nameAr: "اقتصادي" } });
  return { cairo, alexandria, maadi, degla, economy };
};

const post = (agent: Agent, json: Record<string, unknown>) =>
  agent.request("/v1/staff/pricing", { method: "POST", json });

describe("adding prices", () => {
  it("adds one direction, as an EGP string, audited", async () => {
    const { agent, staff } = await signedInStaff(["pricing"]);
    const { cairo, alexandria, economy } = await world();

    const response = await post(agent, {
      fromId: cairo.id,
      toId: alexandria.id,
      classId: economy.id,
      car: "SEDAN",
      price: "1250",
    });
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { id: string }[] };
    expect(data).toEqual([
      {
        id: expect.any(String) as unknown,
        from: {
          id: cairo.id,
          locality: "GOVERNORATE",
          nameEn: "Cairo",
          nameAr: "القاهرة",
          deleted: false,
        },
        to: expect.objectContaining({ id: alexandria.id }) as unknown,
        class: { id: economy.id, nameEn: "Economy", nameAr: "اقتصادي", archived: false },
        car: "SEDAN",
        price: "1250.00",
        active: true,
        updatedAt: expect.any(String) as unknown,
      },
    ]);
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: auditActions.PRICING_CREATED } }),
    ).toMatchObject({
      staffId: staff.id,
      entityId: data[0]?.id,
      after: { fromId: cairo.id, toId: alexandria.id, price: "1250.00" },
    });
  });

  it("adds both directions with bothWays, or neither", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, alexandria, economy } = await world();
    const entry = { classId: economy.id, car: "SUV", price: "900.5", bothWays: true };

    const both = await post(agent, { ...entry, fromId: cairo.id, toId: alexandria.id });
    const { data } = (await both.json()) as { data: { from: { id: string }; price: string }[] };
    expect(data.map((row) => [row.from.id, row.price])).toEqual([
      [cairo.id, "900.50"],
      [alexandria.id, "900.50"],
    ]);

    // The reverse of an existing row exists too: nothing is added.
    const again = await post(agent, { ...entry, fromId: alexandria.id, toId: cairo.id });
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe("PRICING_EXISTS");
    expect(await prisma.pricing.count()).toBe(2);

    // Within one place, bothWays is the same row.
    const within = await post(agent, { ...entry, fromId: cairo.id, toId: cairo.id });
    expect(((await within.json()) as { data: unknown[] }).data).toHaveLength(1);
  });

  it("refuses unknown or deleted places, archived classes, an area to itself and bad prices", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, maadi, degla, economy } = await world();
    const archived = await prisma.tripClass.create({
      data: { nameEn: "Old", nameAr: "قديم", archivedAt: new Date() },
    });
    await prisma.location.update({
      where: { id: maadi.id },
      data: { deletedAt: new Date(), deletedWithId: maadi.id },
    });

    const problems = async (json: Record<string, unknown>) => {
      const response = await post(agent, { car: "SEDAN", price: "100", ...json });
      expect(response.status).toBe(400);
      return ((await response.json()) as { errors: { path: string }[] }).errors.map((e) => e.path);
    };

    expect(await problems({ fromId: "nope", toId: maadi.id, classId: archived.id })).toEqual([
      "fromId",
      "toId",
      "classId",
    ]);
    expect(await problems({ fromId: degla.id, toId: degla.id, classId: economy.id })).toEqual([
      "toId",
    ]);
    for (const price of ["0", "-5", "12.345", "1000000.01", "abc", 12]) {
      expect(
        await problems({ fromId: cairo.id, toId: cairo.id, classId: economy.id, price }),
      ).toEqual(["price"]);
    }
  });

  it("needs pricing to write, and pricing or trips to read", async () => {
    const { agent: trips } = await signedInStaff(["trips"]);
    const { agent: fleet } = await signedInStaff(["fleet"]);
    const { cairo, economy } = await world();

    const refused = await post(trips, {
      fromId: cairo.id,
      toId: cairo.id,
      classId: economy.id,
      car: "SEDAN",
      price: "100",
    });
    expect(refused.status).toBe(403);
    expect((await trips.request("/v1/staff/pricing")).status).toBe(200);
    expect((await fleet.request("/v1/staff/pricing")).status).toBe(403);
    expect((await trips.request("/v1/staff/pricing/export.csv")).status).toBe(403);
  });
});

describe("changing prices", () => {
  it("changes and removes a price, auditing before and after", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, alexandria, economy } = await world();
    const row = await prisma.pricing.create({
      data: {
        fromId: cairo.id,
        toId: alexandria.id,
        classId: economy.id,
        car: "VAN",
        price: "2000",
      },
    });

    const changed = await agent.request(`/v1/staff/pricing/${row.id}`, {
      method: "PATCH",
      json: { price: "2100.00" },
    });
    expect(await changed.json()).toMatchObject({ price: "2100.00" });
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: auditActions.PRICING_UPDATED } }),
    ).toMatchObject({ before: { price: "2000.00" }, after: { price: "2100.00" } });

    const removed = await agent.request(`/v1/staff/pricing/${row.id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(await prisma.pricing.count()).toBe(0);
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: auditActions.PRICING_DELETED } }),
    ).toMatchObject({ before: { price: "2100.00", car: "VAN" } });

    expect((await agent.request(`/v1/staff/pricing/${row.id}`, { method: "DELETE" })).status).toBe(
      404,
    );
  });

  it("lists prices, filtered, searched and paged, marking inactive ones", async () => {
    const { agent } = await signedInStaff(["trips"]);
    const { cairo, alexandria, degla, economy } = await world();
    await prisma.tripClass.update({ where: { id: economy.id }, data: { archivedAt: new Date() } });
    const vip = await prisma.tripClass.create({ data: { nameEn: "VIP", nameAr: "كبار" } });
    for (const [fromId, toId, classId] of [
      [cairo.id, alexandria.id, vip.id],
      [degla.id, alexandria.id, vip.id],
      [alexandria.id, cairo.id, economy.id],
    ] as const) {
      await prisma.pricing.create({ data: { fromId, toId, classId, car: "SEDAN", price: "100" } });
    }

    const get = async (query: string) =>
      (await (await agent.request(`/v1/staff/pricing${query}`)).json()) as {
        data: { from: { nameEn: string }; to: { nameEn: string }; active: boolean }[];
        nextCursor: string | null;
      };

    const all = await get("");
    expect(all.data.map((row) => [row.from.nameEn, row.to.nameEn, row.active])).toEqual([
      ["Alexandria", "Cairo", false],
      ["Cairo", "Alexandria", true],
      ["Degla", "Alexandria", true],
    ]);
    expect((await get(`?q=${encodeURIComponent("دجله")}`)).data).toHaveLength(1);
    expect((await get(`?classId=${vip.id}&toId=${alexandria.id}`)).data).toHaveLength(2);

    const first = await get("?limit=2");
    expect(first.data).toHaveLength(2);
    const second = await get(`?limit=2&cursor=${first.nextCursor ?? ""}`);
    expect(second.data.map((row) => row.from.nameEn)).toEqual(["Degla"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("bulk upload", () => {
  it("adds and updates every row, auditing each change", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, alexandria, maadi, economy } = await world();
    await prisma.pricing.create({
      data: {
        fromId: cairo.id,
        toId: alexandria.id,
        classId: economy.id,
        car: "SEDAN",
        price: "1000",
      },
    });
    await prisma.pricing.create({
      data: {
        fromId: cairo.id,
        toId: alexandria.id,
        classId: economy.id,
        car: "SUV",
        price: "1500",
      },
    });

    const response = await agent.request("/v1/staff/pricing", {
      method: "PUT",
      json: {
        rows: [
          {
            fromId: cairo.id,
            toId: alexandria.id,
            classId: economy.id,
            car: "SEDAN",
            price: "1100",
          },
          {
            fromId: cairo.id,
            toId: alexandria.id,
            classId: economy.id,
            car: "SUV",
            price: "1500.00",
          },
          {
            fromId: maadi.id,
            toId: alexandria.id,
            classId: economy.id,
            car: "SEDAN",
            price: "1200",
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: 1, updated: 1, unchanged: 1 });

    const prices = await prisma.pricing.findMany({ orderBy: { price: "asc" } });
    expect(prices.map((row) => row.price.toFixed(2))).toEqual(["1100.00", "1200.00", "1500.00"]);
    const logs = await prisma.auditLog.findMany({
      where: { action: { in: [auditActions.PRICING_CREATED, auditActions.PRICING_UPDATED] } },
    });
    expect(logs.map((log) => [log.action, log.before, log.after])).toEqual(
      expect.arrayContaining([
        [
          auditActions.PRICING_UPDATED,
          expect.objectContaining({ price: "1000.00" }),
          expect.objectContaining({ price: "1100.00" }),
        ],
        [auditActions.PRICING_CREATED, null, expect.objectContaining({ fromId: maadi.id })],
      ]),
    );
    expect(logs).toHaveLength(2);
  });

  it("saves nothing when any row is wrong, listing every problem", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, alexandria, degla, economy } = await world();
    const good = {
      fromId: cairo.id,
      toId: alexandria.id,
      classId: economy.id,
      car: "SEDAN",
      price: "1",
    };

    const response = await agent.request("/v1/staff/pricing", {
      method: "PUT",
      json: {
        rows: [
          good,
          { ...good, fromId: "nope" },
          { ...good, fromId: degla.id, toId: degla.id },
          { ...good, price: "2" },
        ],
      },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; errors: { path: string }[] };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors.map((error) => error.path)).toEqual([
      "rows.1.fromId",
      "rows.2.toId",
      "rows.3",
    ]);
    expect(await prisma.pricing.count()).toBe(0);
  });

  it("takes at most 500 rows, and needs pricing", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, economy } = await world();
    const row = { fromId: cairo.id, toId: cairo.id, classId: economy.id, car: "SEDAN", price: "1" };

    const tooMany = await agent.request("/v1/staff/pricing", {
      method: "PUT",
      json: { rows: Array.from({ length: 501 }, () => row) },
    });
    expect(tooMany.status).toBe(400);

    const { agent: trips } = await signedInStaff(["trips"]);
    const refused = await trips.request("/v1/staff/pricing", {
      method: "PUT",
      json: { rows: [row] },
    });
    expect(refused.status).toBe(403);
  });
});

describe("the CSV export", () => {
  it("downloads every row with names, safe for spreadsheets", async () => {
    const { agent } = await signedInStaff(["pricing"]);
    const { cairo, economy } = await world();
    const sneaky = await createGovernorate("=HYPERLINK(1)", "خبيث");
    await prisma.pricing.create({
      data: { fromId: sneaky.id, toId: cairo.id, classId: economy.id, car: "SEDAN", price: "75.5" },
    });

    const response = await agent.request("/v1/staff/pricing/export.csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=UTF-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="pricing.csv"');
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
    expect(text.startsWith("﻿")).toBe(true);
    expect(text.slice(1).split("\r\n")).toEqual([
      "fromId,fromNameEn,fromNameAr,toId,toNameEn,toNameAr,classId,classNameEn,classNameAr,car,price,active",
      `${sneaky.id},'=HYPERLINK(1),خبيث,${cairo.id},Cairo,القاهرة,${economy.id},Economy,اقتصادي,SEDAN,75.50,true`,
      "",
    ]);
  });
});
