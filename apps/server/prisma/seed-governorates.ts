// Loads Egypt's 27 governorates and their outlines. Run with
//   pnpm --filter @terhal/server db:seed:governorates <path to the GeoJSON>
// The file is geoBoundaries' ADM1 release for Egypt (gbOpen, derived from OpenStreetMap, ODbL 1.0), not kept in the repo:
//   curl -L -o egypt-adm1.geojson \
//     https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/EGY/ADM1/geoBoundaries-EGY-ADM1.geojson
// (https://www.geoboundaries.org/api/current/gbOpen/EGY/ADM1/ names the current file as gjDownloadURL.)
// Idempotent: governorates are matched by name, created when missing, and an outline is only written when it changed.
// Outlines are simplified to at most 300 points, rounded to 5 decimals, and only a multipolygon's largest part is kept.
import { readFile } from "node:fs/promises";
import { seedGovernorates, type GovernorateFeature } from "../src/modules/location/index";
import { prisma } from "../src/platform/db/prisma";

interface FeatureCollection {
  type?: string;
  features: {
    properties: { shapeISO?: string } | null;
    geometry: GovernorateFeature["geometry"] | null;
  }[];
}

const main = async () => {
  const path = process.argv[2] ?? process.env.GOVERNORATES_GEOJSON;
  if (!path) {
    throw new Error(
      "Pass the geoBoundaries GeoJSON's path (or set GOVERNORATES_GEOJSON). See the top of prisma/seed-governorates.ts.",
    );
  }

  const collection = JSON.parse(await readFile(path, "utf8")) as FeatureCollection;
  if (collection.type !== "FeatureCollection") {
    throw new Error(`${path} isn't a GeoJSON FeatureCollection.`);
  }

  const features = collection.features.flatMap(({ properties, geometry }): GovernorateFeature[] =>
    properties?.shapeISO && (geometry?.type === "Polygon" || geometry?.type === "MultiPolygon")
      ? [{ iso: properties.shapeISO, geometry }]
      : [],
  );

  const result = await seedGovernorates(features);
  console.log(`Created: ${result.created.join(", ") || "none"}.`);
  console.log(`Outlines written: ${result.outlined.join(", ") || "none"}.`);
  console.log(`Outlines unchanged: ${String(result.unchanged.length)}.`);
  if (result.missing.length > 0) {
    console.log(`No outline in the file for: ${result.missing.join(", ")}.`);
    process.exitCode = 1;
  }
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
