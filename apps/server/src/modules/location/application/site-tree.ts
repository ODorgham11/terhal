import { createHash } from "node:crypto";
import type { SiteLocationOutlines, SiteLocations } from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { boundariesOf } from "./queries";

// Where the governorate outlines come from, to show with the map (docs/decisions.md, "Governorate outlines").
export const OUTLINES_ATTRIBUTION =
  "Governorate outlines: geoBoundaries (geoboundaries.org), from © OpenStreetMap contributors, ODbL 1.0.";

const hash = (value: string) => createHash("sha256").update(value).digest("base64url").slice(0, 22);

// The tree's version (the L8 assessment): a hash of the latest updatedAt and the row count. Locations are never hard
// deleted and a soft delete or a restore bumps updatedAt, so any change gives a new version; the seed bumps it too when
// it writes an outline. One index-friendly query per request.
export const treeVersion = async () => {
  const [row] = await prisma.$queryRaw<{ latest: Date | null; count: number }[]>`
    SELECT max("updatedAt") AS "latest", count(*)::int AS "count" FROM "Location"`;
  return hash(`${row?.latest?.toISOString() ?? "none"}:${String(row?.count ?? 0)}`);
};

interface Built {
  version: string;
  tree: string;
  outlines: string;
  outlinesVersion: string;
}

// The serialized responses for the latest version only, kept in memory: building them is a few queries, serving them
// from here is none. Each server process keeps its own.
let built: Built | null = null;

const build = async (version: string): Promise<Built> => {
  const [rows, boundaries] = await Promise.all([
    prisma.location.findMany({
      where: { deletedAt: null },
      orderBy: [{ locality: "asc" }, { nameEn: "asc" }, { id: "asc" }],
      select: {
        id: true,
        parentId: true,
        locality: true,
        nameEn: true,
        nameAr: true,
        latitude: true,
        longitude: true,
        radius: true,
      },
    }),
    boundariesOf("live"),
  ]);

  const outlines: SiteLocationOutlines = {
    data: [...boundaries].map(([id, boundary]) => ({ id, boundary })),
    attribution: OUTLINES_ATTRIBUTION,
  };
  const outlinesBody = JSON.stringify(outlines);
  const outlinesVersion = hash(outlinesBody);

  const tree: SiteLocations = {
    data: rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      locality: row.locality,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      center:
        row.latitude !== null && row.longitude !== null && row.radius !== null
          ? { latitude: Number(row.latitude), longitude: Number(row.longitude), radius: row.radius }
          : null,
    })),
    outlinesVersion,
  };

  return { version, tree: JSON.stringify(tree), outlines: outlinesBody, outlinesVersion };
};

// The live tree and outlines at their current version, rebuilt only when the version moved.
export const siteTree = async () => {
  const version = await treeVersion();
  if (built?.version !== version) built = await build(version);
  return built;
};
