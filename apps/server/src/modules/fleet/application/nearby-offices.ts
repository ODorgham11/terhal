import type { NearbyOfficesQuery } from "@terhal/contracts";
import { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { officeSelect, toOffice } from "./shared";

// Great-circle distance in meters between a point and a location's center (haversine, as coverage does; see
// docs/decisions.md, "Coverage without PostGIS"). Null for a governorate, which has no center.
const distanceFrom = (latitude: number, longitude: number, alias: string) => Prisma.sql`
  CASE WHEN ${Prisma.raw(alias)}."latitude" IS NULL THEN NULL ELSE
    2 * 6371000 * asin(sqrt(
      power(sin(radians(${Prisma.raw(alias)}."latitude"::float8 - ${latitude}::float8) / 2), 2)
      + cos(radians(${latitude}::float8)) * cos(radians(${Prisma.raw(alias)}."latitude"::float8))
      * power(sin(radians(${Prisma.raw(alias)}."longitude"::float8 - ${longitude}::float8) / 2), 2)
    ))
  END`;

// The most specific live location covering a point: an area before a district before a governorate (L7), then the
// nearest center. A district or an area covers the circle around its center; a governorate, its outline.
// TODO: use the location module's coverage once merged.
const coveringLocation = async (latitude: number, longitude: number) => {
  const [location] = await prisma.$queryRaw<
    { id: string; nameEn: string; nameAr: string; locality: "GOVERNORATE" | "DISTRICT" | "AREA" }[]
  >`
    SELECT l."id", l."nameEn", l."nameAr", l."locality"
    FROM (SELECT *, ${distanceFrom(latitude, longitude, "x")} AS "distance" FROM "Location" x
          WHERE x."deletedAt" IS NULL) l
    WHERE (l."locality" <> 'GOVERNORATE' AND l."distance" <= l."radius")
       OR (l."locality" = 'GOVERNORATE' AND l."boundary" @> point(${longitude}::float8, ${latitude}::float8))
    ORDER BY CASE l."locality" WHEN 'AREA' THEN 0 WHEN 'DISTRICT' THEN 1 ELSE 2 END, l."distance" NULLS LAST
    LIMIT 1`;
  return location ?? null;
};

// Offices for a pickup (O3): live offices whose location is the pin's location, one of its ancestors or one of its live
// descendants, nearest first (by the distance from the pin to the office location's center; offices placed at a
// governorate, which has no center, come last), then by name. A pin outside coverage has none.
export const nearbyOffices = async ({ latitude, longitude }: NearbyOfficesQuery) => {
  const location = await coveringLocation(latitude, longitude);
  if (!location) return { location: null, data: [] };

  const ranked = await prisma.$queryRaw<{ id: string; distance: number | null }[]>`
    WITH RECURSIVE
      ancestors AS (
        SELECT "id", "parentId" FROM "Location" WHERE "id" = ${location.id}
        UNION
        SELECT p."id", p."parentId" FROM "Location" p JOIN ancestors a ON p."id" = a."parentId"
      ),
      descendants AS (
        SELECT "id" FROM "Location" WHERE "id" = ${location.id}
        UNION
        SELECT c."id" FROM "Location" c JOIN descendants d ON c."parentId" = d."id" WHERE c."deletedAt" IS NULL
      )
    SELECT o."id", ${distanceFrom(latitude, longitude, "l")} AS "distance"
    FROM "Office" o JOIN "Location" l ON l."id" = o."locationId"
    WHERE o."archivedAt" IS NULL
      AND o."locationId" IN (SELECT "id" FROM ancestors UNION SELECT "id" FROM descendants)
    ORDER BY "distance" ASC NULLS LAST, o."name" ASC`;

  const offices = await prisma.office.findMany({
    where: { id: { in: ranked.map((office) => office.id) } },
    select: officeSelect,
  });
  const byId = new Map(offices.map((office) => [office.id, office]));

  return {
    location,
    data: ranked.flatMap(({ id, distance }) => {
      const office = byId.get(id);
      return office
        ? [{ ...toOffice(office), distanceMeters: distance === null ? null : Math.round(distance) }]
        : [];
    }),
  };
};
