import type { Coverage, Pin, ResolvedLocation } from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { boundingBox } from "../domain/coverage";
import { chainsOf, resolvedFrom, type Client } from "./queries";

// The most specific live location covering a point (L7): an area before a district before a governorate, then the
// nearest center among circles of the same locality. Circles are measured with the haversine formula (a circle in
// degrees is an ellipse on the ground), only for centers inside a bounding box around the point; governorates by their
// outline, with Postgres's polygon containment (@>). Points are (longitude, latitude).
export const coveringLocationId = async (
  { latitude, longitude }: Pin,
  client: Client = prisma,
): Promise<string | null> => {
  const box = boundingBox({ latitude, longitude });
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM (
        SELECT "id", CASE "locality" WHEN 'AREA' THEN 2 ELSE 1 END AS "rank", "distance"
        FROM (
            SELECT "id", "locality", "radius",
                2 * 6371008.8 * asin(least(1, sqrt(
                    power(sin(radians("latitude"::float8 - ${latitude}::float8) / 2), 2)
                    + cos(radians(${latitude}::float8)) * cos(radians("latitude"::float8))
                    * power(sin(radians("longitude"::float8 - ${longitude}::float8) / 2), 2)
                ))) AS "distance"
            FROM "Location"
            WHERE "deletedAt" IS NULL AND "locality" <> 'GOVERNORATE'
                AND "latitude" BETWEEN ${box.minLatitude}::float8 AND ${box.maxLatitude}::float8
                AND "longitude" BETWEEN ${box.minLongitude}::float8 AND ${box.maxLongitude}::float8
        ) circles
        WHERE "distance" <= "radius"
        UNION ALL
        SELECT "id", 0 AS "rank", NULL AS "distance"
        FROM "Location"
        WHERE "deletedAt" IS NULL AND "locality" = 'GOVERNORATE'
            AND "boundary" @> point(${longitude}::float8, ${latitude}::float8)
    ) matches
    ORDER BY "rank" DESC, "distance" ASC NULLS LAST, "id"
    LIMIT 1`;
  return rows[0]?.id ?? null;
};

// The most specific location covering the point, named with its ancestors, or null when nothing covers it.
export const resolvePin = async (
  pin: Pin,
  client: Client = prisma,
): Promise<ResolvedLocation | null> => {
  const id = await coveringLocationId(pin, client);
  if (!id) return null;
  const chain = (await chainsOf([id], client)).get(id);
  return chain ? resolvedFrom(chain) : null;
};

export const coverage = async (pin: Pin): Promise<Coverage> => {
  const location = await resolvePin(pin);
  return { covered: location !== null, location };
};
