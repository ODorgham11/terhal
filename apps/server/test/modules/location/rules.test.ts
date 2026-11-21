import { describe, expect, it } from "vitest";
import { boundingBox, haversine } from "../../../src/modules/location/domain/coverage";
import {
  outerRing,
  parsePolygon,
  polygonText,
  simplifyRing,
  toGeoJson,
  type Point,
} from "../../../src/modules/location/domain/outline";
import { canSitIn, restoreRefusal } from "../../../src/modules/location/domain/tree";

describe("the tree's parent rule", () => {
  it("narrows from governorates to districts to areas, letting an area skip the district", () => {
    expect(canSitIn("GOVERNORATE", null)).toBe(true);
    expect(canSitIn("GOVERNORATE", "GOVERNORATE")).toBe(false);
    expect(canSitIn("DISTRICT", "GOVERNORATE")).toBe(true);
    expect(canSitIn("DISTRICT", "DISTRICT")).toBe(false);
    expect(canSitIn("DISTRICT", null)).toBe(false);
    expect(canSitIn("AREA", "GOVERNORATE")).toBe(true);
    expect(canSitIn("AREA", "DISTRICT")).toBe(true);
    expect(canSitIn("AREA", "AREA")).toBe(false);
    expect(canSitIn("AREA", null)).toBe(false);
  });
});

describe("restoring", () => {
  const deleted = new Date();
  it("is only for the root of a delete, under a live parent", () => {
    expect(restoreRefusal({ id: "a", deletedAt: null, deletedWithId: null }, null)).toBe(
      "not_deleted",
    );
    expect(restoreRefusal({ id: "a", deletedAt: deleted, deletedWithId: "b" }, null)).toBe(
      "deleted_with_another",
    );
    expect(
      restoreRefusal({ id: "a", deletedAt: deleted, deletedWithId: "a" }, { deletedAt: deleted }),
    ).toBe("parent_deleted");
    expect(
      restoreRefusal({ id: "a", deletedAt: deleted, deletedWithId: "a" }, { deletedAt: null }),
    ).toBeNull();
  });
});

describe("distances", () => {
  it("measures great-circle meters", () => {
    // One degree of latitude is about 111.2 km everywhere.
    expect(haversine({ latitude: 30, longitude: 31 }, { latitude: 31, longitude: 31 })).toBeCloseTo(
      111_195,
      -1,
    );
  });

  it("boxes every center within the radius, wider in longitude away from the equator", () => {
    const pin = { latitude: 30, longitude: 31 };
    const box = boundingBox(pin, 10_000);
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const radians = (bearing * Math.PI) / 180;
      // A point just inside 10 km in this direction.
      const point = {
        latitude: pin.latitude + (9_990 * Math.cos(radians)) / 111_195,
        longitude:
          pin.longitude + (9_990 * Math.sin(radians)) / (111_195 * Math.cos((30 * Math.PI) / 180)),
      };
      expect(point.latitude).toBeGreaterThanOrEqual(box.minLatitude);
      expect(point.latitude).toBeLessThanOrEqual(box.maxLatitude);
      expect(point.longitude).toBeGreaterThanOrEqual(box.minLongitude);
      expect(point.longitude).toBeLessThanOrEqual(box.maxLongitude);
    }
    expect(box.maxLongitude - pin.longitude).toBeGreaterThan(box.maxLatitude - pin.latitude);
  });
});

describe("outlines", () => {
  it("round-trip between Postgres's text and GeoJSON, closing the ring", () => {
    const points = parsePolygon("((31.1,30.2),(31.5,30.2),(31.5,-30.6))");
    expect(points).toEqual([
      [31.1, 30.2],
      [31.5, 30.2],
      [31.5, -30.6],
    ]);
    expect(polygonText(points)).toBe("((31.1,30.2),(31.5,30.2),(31.5,-30.6))");
    expect(toGeoJson(points).coordinates[0]).toEqual([
      [31.1, 30.2],
      [31.5, 30.2],
      [31.5, -30.6],
      [31.1, 30.2],
    ]);
  });

  it("keep a multipolygon's largest part", () => {
    const small = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const large = [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
      [10, 10],
    ];
    expect(outerRing({ type: "MultiPolygon", coordinates: [[small], [large]] })).toHaveLength(5);
  });

  it("are simplified to at most 300 points, rounded to 5 decimals, keeping the shape", () => {
    // A circle of 2,000 points with a wobble, as detailed as open data gets.
    const circle: Point[] = Array.from({ length: 2000 }, (_, i) => {
      const angle = (i / 2000) * 2 * Math.PI;
      const radius = 1 + 0.01 * Math.sin(angle * 40);
      return [31 + radius * Math.cos(angle) + 1e-7, 30 + radius * Math.sin(angle)] as const;
    });

    const simplified = simplifyRing(circle);
    expect(simplified.length).toBeLessThanOrEqual(300);
    expect(simplified.length).toBeGreaterThan(20);
    for (const [x, y] of simplified) {
      expect(Number(x.toFixed(5))).toBe(x);
      expect(Number(y.toFixed(5))).toBe(y);
      expect(Math.hypot(x - 31, y - 30)).toBeGreaterThan(0.98);
      expect(Math.hypot(x - 31, y - 30)).toBeLessThan(1.02);
    }
    // The ring stays open: Postgres closes polygons itself.
    expect(simplified[0]).not.toEqual(simplified.at(-1));
  });

  it("leave a small outline as it is, apart from rounding", () => {
    expect(
      simplifyRing([
        [31.123456789, 30],
        [32, 30],
        [32, 31],
        [31.123456789, 30],
      ]),
    ).toEqual([
      [31.12346, 30],
      [32, 30],
      [32, 31],
    ]);
  });
});
