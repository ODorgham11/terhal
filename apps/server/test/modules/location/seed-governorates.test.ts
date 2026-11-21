import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { seedGovernorates, type GovernorateFeature } from "../../../src/modules/location/index";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { createGovernorate } from "../../support/locations";

beforeEach(async () => {
  await resetDatabase();
});

// A detailed circle of `count` points around a center, as open data would have it.
const circle = (longitude: number, latitude: number, count = 1000): number[][] =>
  Array.from({ length: count + 1 }, (_, i) => {
    const angle = ((i % count) / count) * 2 * Math.PI;
    return [longitude + 0.3 * Math.cos(angle), latitude + 0.3 * Math.sin(angle)];
  });

const cairo: GovernorateFeature = {
  iso: "EG-C",
  geometry: { type: "Polygon", coordinates: [circle(31.25, 30.05)] },
};
// Port Said with an island: only the mainland is kept.
const portSaid: GovernorateFeature = {
  iso: "EG-PTS",
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [circle(32.3, 31.25)],
      [
        [
          [32.9, 31.5],
          [32.91, 31.5],
          [32.91, 31.51],
          [32.9, 31.5],
        ],
      ],
    ],
  },
};

const outline = async (nameEn: string) => {
  const [row] = await prisma.$queryRaw<{ points: number; boundary: string }[]>`
    SELECT npoints("boundary") AS "points", "boundary"::text AS "boundary" FROM "Location" WHERE "nameEn" = ${nameEn}`;
  return row;
};

describe("the governorate seed", () => {
  it("creates all 27 governorates and writes the outlines it has, simplified", async () => {
    const result = await seedGovernorates([cairo, portSaid]);

    expect(result.created).toHaveLength(27);
    expect(result.outlined.sort()).toEqual(["Cairo", "Port Said"]);
    expect(result.missing).toHaveLength(25);
    expect(
      await prisma.location.count({ where: { locality: "GOVERNORATE", parentId: null } }),
    ).toBe(27);

    const cairoOutline = await outline("Cairo");
    expect(cairoOutline?.points).toBeLessThanOrEqual(300);
    expect(cairoOutline?.points).toBeGreaterThan(20);
    // Rounded to 5 decimals.
    expect(cairoOutline?.boundary).not.toMatch(/\.\d{6}/);
    expect((await outline("Port Said"))?.boundary).not.toContain("32.9,");

    expect(
      await prisma.auditLog.count({
        where: { action: auditActions.LOCATION_CREATED, adminId: null, staffId: null },
      }),
    ).toBe(27);
  });

  it("matches existing governorates by name and changes nothing when run again", async () => {
    const renamed = await createGovernorate("cairo", "القاهره");

    await seedGovernorates([cairo]);
    const cairos = await prisma.location.findMany({ where: { nameAr: { startsWith: "القاهر" } } });
    expect(cairos.map((row) => row.id)).toEqual([renamed.id]);

    const before = await prisma.location.findUniqueOrThrow({ where: { id: renamed.id } });
    const again = await seedGovernorates([cairo]);
    expect(again).toMatchObject({ created: [], outlined: [], unchanged: ["Cairo"] });
    const after = await prisma.location.findUniqueOrThrow({ where: { id: renamed.id } });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
