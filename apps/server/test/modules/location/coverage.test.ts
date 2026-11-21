import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { createGovernorate, createPlace, squareAround } from "../../support/locations";
import { resetRedis } from "../../support/redis";
import { signedInStaff } from "../../support/staff-agents";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = ReturnType<typeof createAgent>;

const covering = async (agent: Agent, path: string, latitude: number, longitude: number) => {
  const response = await agent.request(
    `${path}?latitude=${String(latitude)}&longitude=${String(longitude)}`,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    covered: boolean;
    location: { nameEn: string; ancestors: { nameEn: string }[] } | null;
  };
};

const site = createAgent(SITE_ORIGIN);
const siteCoverage = (latitude: number, longitude: number) =>
  covering(site, "/v1/site/locations/coverage", latitude, longitude);

// 0.01° of latitude is about 1.1 km.
describe("coverage", () => {
  it("prefers an area to a district to a governorate, even when the district's center is nearer", async () => {
    const cairo = await createGovernorate("Cairo", "القاهرة", squareAround(31.25, 30));
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi", {
      latitude: 30,
      longitude: 31.25,
      radius: 5000,
    });
    await createPlace(maadi.id, "AREA", "Degla", {
      latitude: 30.02,
      longitude: 31.25,
      radius: 3000,
    });

    expect(await siteCoverage(30.001, 31.25)).toEqual({
      covered: true,
      location: {
        id: expect.any(String) as unknown,
        locality: "AREA",
        nameEn: "Degla",
        nameAr: "Degla ع",
        ancestors: [
          { id: cairo.id, locality: "GOVERNORATE", nameEn: "Cairo", nameAr: "القاهرة" },
          { id: maadi.id, locality: "DISTRICT", nameEn: "Maadi", nameAr: "Maadi ع" },
        ],
      },
    });
    // Outside Degla's 3 km, inside Maadi's 5 km.
    expect((await siteCoverage(29.97, 31.25)).location?.nameEn).toBe("Maadi");
    // Outside every circle, inside Cairo's outline.
    expect((await siteCoverage(30.3, 31.5)).location?.nameEn).toBe("Cairo");
  });

  it("takes the nearest center among circles of the same locality", async () => {
    const cairo = await createGovernorate("Cairo");
    await createPlace(cairo.id, "AREA", "North", { latitude: 30.01, longitude: 31, radius: 5000 });
    await createPlace(cairo.id, "AREA", "South", { latitude: 29.99, longitude: 31, radius: 5000 });

    expect((await siteCoverage(30.004, 31)).location?.nameEn).toBe("North");
    expect((await siteCoverage(29.996, 31)).location?.nameEn).toBe("South");
  });

  it("measures circles on the ground, not in degrees", async () => {
    const cairo = await createGovernorate("Cairo");
    await createPlace(cairo.id, "AREA", "Ring", { latitude: 30, longitude: 31, radius: 10_000 });

    // 0.1° of longitude at 30°N is about 9.6 km: inside. 0.1° of latitude is about 11.1 km: outside.
    expect((await siteCoverage(30, 31.1)).covered).toBe(true);
    expect((await siteCoverage(30.1, 31)).covered).toBe(false);
  });

  it("ignores deleted places and says when nothing covers a point", async () => {
    const cairo = await createGovernorate("Cairo", "القاهرة", squareAround(31, 30));
    const maadi = await createPlace(cairo.id, "DISTRICT", "Maadi");
    await prisma.location.updateMany({
      where: { id: { in: [cairo.id, maadi.id] } },
      data: { deletedAt: new Date(), deletedWithId: cairo.id },
    });

    expect(await siteCoverage(30, 31)).toEqual({ covered: false, location: null });
  });

  it("is the same for admins and staff, and checks the point", async () => {
    const cairo = await createGovernorate("Cairo");
    await createPlace(cairo.id, "AREA", "Downtown");
    const { agent: admin } = await signedInAdmin();
    const { agent: staff } = await signedInStaff([]);

    expect((await covering(admin, "/v1/admin/locations/coverage", 30, 31)).covered).toBe(true);
    expect((await covering(staff, "/v1/staff/locations/coverage", 30, 31)).covered).toBe(true);

    const invalid = await site.request("/v1/site/locations/coverage?latitude=91&longitude=31");
    expect(invalid.status).toBe(400);
  });
});
