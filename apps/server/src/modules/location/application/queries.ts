import type { Locality, LocationSummary, ResolvedLocation } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { parsePolygon, toGeoJson } from "../domain/outline";

export type Client = typeof prisma | Prisma.TransactionClient;

// Whether a location exists and isn't deleted, e.g. for an office being pointed at it.
export const isLiveLocation = async (id: string, client: Client = prisma) =>
  (await client.location.count({ where: { id, deletedAt: null } })) > 0;

interface ChainRow {
  start: string;
  depth: number;
  id: string;
  locality: Locality;
  nameEn: string;
  nameAr: string;
}

// Each location with every place it sits in, from the location itself (first) up to its governorate (last), in one
// query. Ids that don't exist are left out of the map.
export const chainsOf = async (ids: readonly string[], client: Client = prisma) => {
  if (ids.length === 0) return new Map<string, LocationSummary[]>();
  const rows = await client.$queryRaw<ChainRow[]>`
    WITH RECURSIVE chain AS (
        SELECT "id" AS "start", 0 AS "depth", "id", "parentId", "locality", "nameEn", "nameAr"
        FROM "Location" WHERE "id" = ANY(${[...ids]}::text[])
        UNION ALL
        SELECT chain."start", chain."depth" + 1, parent."id", parent."parentId", parent."locality", parent."nameEn",
            parent."nameAr"
        FROM "Location" parent JOIN chain ON parent."id" = chain."parentId"
    )
    SELECT "start", "depth", "id", "locality"::text AS "locality", "nameEn", "nameAr" FROM chain
    ORDER BY "start", "depth"`;

  const chains = new Map<string, LocationSummary[]>();
  for (const { start, id, locality, nameEn, nameAr } of rows) {
    const chain = chains.get(start) ?? [];
    chain.push({ id, locality, nameEn, nameAr });
    chains.set(start, chain);
  }
  return chains;
};

// A location named with its ancestors, governorate first, as coverage and quotes show it.
export const resolvedFrom = (chain: readonly LocationSummary[]): ResolvedLocation => {
  const [self, ...above] = chain;
  if (!self) throw new Error("A location chain can't be empty.");
  return { ...self, ancestors: above.reverse() };
};

// The ids of a location and its live descendants, the location first. Empty when the location itself isn't live.
export const liveSubtree = async (id: string, client: Client = prisma) => {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
        SELECT "id", 0 AS "depth" FROM "Location" WHERE "id" = ${id} AND "deletedAt" IS NULL
        UNION ALL
        SELECT child."id", subtree."depth" + 1
        FROM "Location" child JOIN subtree ON child."parentId" = subtree."id"
        WHERE child."deletedAt" IS NULL
    )
    SELECT "id" FROM subtree ORDER BY "depth", "id"`;
  return rows.map((row) => row.id);
};

// Which of these locations have an outline. Prisma can't read the polygon column, so it's asked for directly.
export const withBoundary = async (ids: readonly string[], client: Client = prisma) => {
  if (ids.length === 0) return new Set<string>();
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Location" WHERE "id" = ANY(${[...ids]}::text[]) AND "boundary" IS NOT NULL`;
  return new Set(rows.map((row) => row.id));
};

// Live governorates' outlines as GeoJSON, by id.
export const boundariesOf = async (ids: readonly string[] | "live", client: Client = prisma) => {
  const rows =
    ids === "live"
      ? await client.$queryRaw<{ id: string; boundary: string }[]>`
          SELECT "id", "boundary"::text AS "boundary" FROM "Location"
          WHERE "deletedAt" IS NULL AND "boundary" IS NOT NULL ORDER BY "id"`
      : await client.$queryRaw<{ id: string; boundary: string }[]>`
          SELECT "id", "boundary"::text AS "boundary" FROM "Location"
          WHERE "id" = ANY(${[...ids]}::text[]) AND "boundary" IS NOT NULL ORDER BY "id"`;
  return new Map(rows.map((row) => [row.id, toGeoJson(parsePolygon(row.boundary))]));
};
