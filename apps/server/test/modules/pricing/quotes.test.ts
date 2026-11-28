import { beforeEach, describe, expect, it } from "vitest";
import { priceFor } from "../../../src/modules/pricing/index";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { createGovernorate, createPlace, squareAround } from "../../support/locations";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const site = createAgent(SITE_ORIGIN);

// Cairo (an outline around 31.25, 30) holds Maadi (a district) holding Degla (an area); Alexandria (an outline around
// 29.9, 31.2) holds Smouha (an area directly in the governorate).
const pins = {
  degla: { latitude: 29.96, longitude: 31.26 },
  maadiOnly: { latitude: 29.99, longitude: 31.26 },
  cairoOnly: { latitude: 30.3, longitude: 31.5 },
  smouha: { latitude: 31.2, longitude: 29.95 },
  alexandriaOnly: { latitude: 31.5, longitude: 29.6 },
  sea: { latitude: 33, longitude: 33 },
};

const world = async () => {
  const cairo = await createGovernorate("Cairo", "القاهرة", squareAround(31.25, 30));
  const alexandria = await createGovernorate("Alexandria", "الإسكندرية", squareAround(29.9, 31.2));
  const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi", {
    latitude: 29.97,
    longitude: 31.26,
    radius: 4000,
  });
  const degla = await createPlace(maadi.id, "AREA", "Degla", {
    latitude: 29.96,
    longitude: 31.26,
    radius: 1000,
  });
  const smouha = await createPlace(alexandria.id, "AREA", "Smouha", {
    latitude: 31.2,
    longitude: 29.95,
    radius: 2000,
  });
  const economy = await prisma.tripClass.create({
    data: { nameEn: "Economy", nameAr: "اقتصادي", sortOrder: 1 },
  });
  const vip = await prisma.tripClass.create({
    data: { nameEn: "VIP", nameAr: "كبار", sortOrder: 2 },
  });
  return { cairo, alexandria, maadi, degla, smouha, economy, vip };
};

const price = (fromId: string, toId: string, classId: string, value: string, car = "SEDAN") =>
  prisma.pricing.create({
    data: { fromId, toId, classId, car: car as "SEDAN", price: value },
  });

interface Option {
  class: { nameEn: string };
  car: string;
  fits: boolean;
  price: string | null;
  returnPrice: string | null;
}

const ask = async (json: Record<string, unknown>) => {
  const response = await site.request("/v1/site/quotes", {
    method: "POST",
    json: { passengers: 2, ...json },
  });
  return { response, body: (await response.json()) as Record<string, unknown> };
};

const sedan = (options: Option[], className = "Economy") =>
  options.find((option) => option.class.nameEn === className && option.car === "SEDAN");

describe("quotes", () => {
  it("resolve both pins and offer every class with every body, fit flags and null prices", async () => {
    const { degla, smouha, economy } = await world();
    await price(degla.id, smouha.id, economy.id, "1500");

    const { response, body } = await ask({
      pickup: pins.degla,
      dropoff: pins.smouha,
      passengers: 5,
      largeLuggage: 1,
    });
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      pickup: {
        id: degla.id,
        locality: "AREA",
        ancestors: [{ nameEn: "Cairo" }, { nameEn: "Maadi" }],
      },
      dropoff: { id: smouha.id, ancestors: [{ nameEn: "Alexandria" }] },
      return: null,
    });
    const options = body.options as Option[];
    expect(
      options.map((option) => [option.class.nameEn, option.car, option.fits, option.price]),
    ).toEqual([
      ["Economy", "SEDAN", false, "1500.00"],
      ["Economy", "SUV", true, null],
      ["Economy", "MINIVAN", true, null],
      ["Economy", "VAN", true, null],
      ["VIP", "SEDAN", false, null],
      ["VIP", "SUV", true, null],
      ["VIP", "MINIVAN", true, null],
      ["VIP", "VAN", true, null],
    ]);
    expect(options.every((option) => option.returnPrice === null)).toBe(true);
  });

  it("walk up the tree to the most specific priced pair, preferring the more specific pickup", async () => {
    const { cairo, alexandria, maadi, degla, smouha, economy } = await world();
    await price(cairo.id, alexandria.id, economy.id, "1000");
    const quoted = async (pickup: object, dropoff: object) =>
      sedan((await ask({ pickup, dropoff })).body.options as Option[])?.price;

    // Only the governorates are priced: every place in them takes that price.
    expect(await quoted(pins.degla, pins.smouha)).toBe("1000.00");
    expect(await quoted(pins.cairoOnly, pins.alexandriaOnly)).toBe("1000.00");

    // Specificity is by locality: Cairo → Smouha (governorate + area) beats Maadi → Alexandria (district +
    // governorate).
    await price(cairo.id, smouha.id, economy.id, "1100");
    await price(maadi.id, alexandria.id, economy.id, "1200");
    expect(await quoted(pins.degla, pins.smouha)).toBe("1100.00");
    // Degla → Alexandria ties with Cairo → Smouha; the more specific pickup wins.
    await price(degla.id, alexandria.id, economy.id, "1250");
    expect(await quoted(pins.degla, pins.smouha)).toBe("1250.00");
    // Maadi → Smouha is more specific than all of them.
    await price(maadi.id, smouha.id, economy.id, "1300");
    expect(await quoted(pins.degla, pins.smouha)).toBe("1300.00");
    // An exact pair beats everything; a pin only in Maadi doesn't reach Degla's row.
    await price(degla.id, smouha.id, economy.id, "1400");
    expect(await quoted(pins.degla, pins.smouha)).toBe("1400.00");
    expect(await quoted(pins.maadiOnly, pins.smouha)).toBe("1300.00");
    // Rows run one way: nothing priced from Alexandria.
    expect(await quoted(pins.smouha, pins.degla)).toBeNull();
  });

  it("skip archived classes and the rows of deleted places", async () => {
    const { cairo, alexandria, maadi, economy, vip } = await world();
    await price(cairo.id, alexandria.id, economy.id, "1000");
    await price(maadi.id, alexandria.id, economy.id, "900");
    await prisma.tripClass.update({ where: { id: vip.id }, data: { archivedAt: new Date() } });

    const before = (await ask({ pickup: pins.maadiOnly, dropoff: pins.smouha })).body;
    expect((before.options as Option[]).map((option) => option.class.nameEn)).not.toContain("VIP");
    expect(sedan(before.options as Option[])?.price).toBe("900.00");

    // Deleting Maadi (and Degla with it): the pin now resolves to Cairo, and Maadi's row stops counting.
    await prisma.location.updateMany({
      where: { OR: [{ id: maadi.id }, { parentId: maadi.id }] },
      data: { deletedAt: new Date(), deletedWithId: maadi.id },
    });
    const after = (await ask({ pickup: pins.maadiOnly, dropoff: pins.smouha })).body;
    expect(after.pickup).toMatchObject({ id: cairo.id });
    expect(sedan(after.options as Option[])?.price).toBe("1000.00");
  });

  it("price a return leg from the reverse route, with pins reversed unless given", async () => {
    const { cairo, alexandria, degla, smouha, economy } = await world();
    await price(cairo.id, alexandria.id, economy.id, "1000");
    await price(alexandria.id, cairo.id, economy.id, "800");
    await price(smouha.id, degla.id, economy.id, "750");

    const reversed = (await ask({ pickup: pins.degla, dropoff: pins.smouha, return: {} })).body;
    expect(reversed.return).toMatchObject({ pickup: { id: smouha.id }, dropoff: { id: degla.id } });
    expect(sedan(reversed.options as Option[])).toMatchObject({
      price: "1000.00",
      returnPrice: "750.00",
    });

    const elsewhere = (
      await ask({
        pickup: pins.degla,
        dropoff: pins.smouha,
        return: { pickup: pins.alexandriaOnly, dropoff: pins.cairoOnly },
      })
    ).body;
    expect(sedan(elsewhere.options as Option[])?.returnPrice).toBe("800.00");
  });

  it("refuse a pin outside coverage and two pins in the same place", async () => {
    await world();

    const outside = await ask({ pickup: pins.degla, dropoff: pins.sea });
    expect(outside.response.status).toBe(422);
    expect(outside.body).toMatchObject({
      code: "OUT_OF_COVERAGE",
      end: "dropoff",
      leg: "outbound",
    });

    const same = await ask({
      pickup: pins.degla,
      dropoff: { latitude: 29.961, longitude: 31.261 },
    });
    expect(same.response.status).toBe(422);
    expect(same.body).toMatchObject({ code: "QUOTE_SAME_PLACE", leg: "outbound" });

    const sameReturn = await ask({
      pickup: pins.degla,
      dropoff: pins.smouha,
      return: { dropoff: pins.smouha },
    });
    expect(sameReturn.body).toMatchObject({ code: "QUOTE_SAME_PLACE", leg: "return" });

    // A district and an area inside it are different places.
    const nested = await ask({ pickup: pins.degla, dropoff: pins.maadiOnly });
    expect(nested.response.status).toBe(200);
  });

  it("book the whole of a flexible governorate when an end names it", async () => {
    const { alexandria, degla, smouha } = await world();

    // Smouha's pin, but the whole of Alexandria asked for: not flexible yet.
    const refused = await ask({
      pickup: pins.degla,
      dropoff: { ...pins.smouha, locationId: alexandria.id },
    });
    expect(refused.response.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: "LOCATION_NOT_FLEXIBLE",
      end: "dropoff",
      leg: "outbound",
    });

    await prisma.location.update({ where: { id: alexandria.id }, data: { flexible: true } });
    const whole = await ask({
      pickup: pins.degla,
      dropoff: { ...pins.smouha, locationId: alexandria.id },
    });
    expect(whole.response.status).toBe(200);
    expect(whole.body).toMatchObject({
      pickup: { id: degla.id },
      dropoff: { id: alexandria.id, locality: "GOVERNORATE", ancestors: [] },
    });

    // A district or an area isn't booked by name: the pin decides, as before.
    const byPin = await ask({
      pickup: pins.degla,
      dropoff: { ...pins.smouha, locationId: smouha.id },
    });
    expect(byPin.body).toMatchObject({ code: "LOCATION_NOT_FLEXIBLE" });
  });

  it("check the request", async () => {
    const { body, response } = await ask({
      pickup: pins.degla,
      dropoff: pins.smouha,
      passengers: 0,
    });
    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("are open to staff with trips", async () => {
    await world();
    const json = { pickup: pins.degla, dropoff: pins.smouha, passengers: 1 };
    const { agent: trips } = await signedInStaff(["trips"]);
    const { agent: pricing } = await signedInStaff(["pricing"]);

    expect((await trips.request("/v1/staff/quotes", { method: "POST", json })).status).toBe(200);
    expect((await pricing.request("/v1/staff/quotes", { method: "POST", json })).status).toBe(403);
  });
});

describe("priceFor", () => {
  it("recomputes one option's price for booking", async () => {
    const { cairo, alexandria, degla, smouha, economy, vip } = await world();
    await price(cairo.id, alexandria.id, economy.id, "1000");
    await price(cairo.id, alexandria.id, vip.id, "2000");

    const option = { pickupId: degla.id, dropoffId: smouha.id, car: "SEDAN" as const };
    expect(await priceFor({ ...option, classId: economy.id })).toBe("1000.00");
    expect(await priceFor({ ...option, classId: vip.id, car: "SUV" })).toBeNull();

    await prisma.tripClass.update({ where: { id: vip.id }, data: { archivedAt: new Date() } });
    expect(await priceFor({ ...option, classId: vip.id })).toBeNull();
    expect(await priceFor({ ...option, pickupId: "nope", classId: economy.id })).toBeNull();
  });
});
