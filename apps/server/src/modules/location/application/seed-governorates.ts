import { auditActions } from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { recordAudit } from "../../audit/index";
import { governorates } from "../domain/governorates";
import { outerRing, polygonText, simplifyRing, type Geometry } from "../domain/outline";

export interface GovernorateFeature {
  iso: string;
  geometry: Geometry;
}

export interface SeedResult {
  created: string[];
  outlined: string[];
  unchanged: string[];
  missing: string[];
}

// Loads the governorates and their outlines (L9: seed only, nothing else writes an outline). Idempotent: each one is
// matched to a live governorate by its English or Arabic name (normalized), created when there's none, and its outline
// is written only when it differs, so running it again changes nothing. Outlines are simplified to at most 300 points
// rounded to 5 decimals (the L8 assessment). Recorded in the audit log as the system's doing.
export const seedGovernorates = async (
  features: readonly GovernorateFeature[],
): Promise<SeedResult> => {
  const byIso = new Map(features.map((feature) => [feature.iso, feature]));
  const result: SeedResult = { created: [], outlined: [], unchanged: [], missing: [] };

  for (const governorate of governorates) {
    const feature = byIso.get(governorate.iso);
    const ring = feature ? simplifyRing(outerRing(feature.geometry)) : [];

    await prisma.$transaction(async (tx) => {
      const [match] = await tx.$queryRaw<{ id: string; boundary: string | null }[]>`
        SELECT "id", "boundary"::text AS "boundary" FROM "Location"
        WHERE "locality" = 'GOVERNORATE' AND "deletedAt" IS NULL
            AND (search_normalize("nameEn") = search_normalize(${governorate.nameEn})
                OR search_normalize("nameAr") = search_normalize(${governorate.nameAr}))
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE`;

      let id = match?.id;
      if (!id) {
        ({ id } = await tx.location.create({
          data: { locality: "GOVERNORATE", nameEn: governorate.nameEn, nameAr: governorate.nameAr },
          select: { id: true },
        }));
        await recordAudit(
          {
            action: auditActions.LOCATION_CREATED,
            entityType: "Location",
            entityId: id,
            after: {
              locality: "GOVERNORATE",
              nameEn: governorate.nameEn,
              nameAr: governorate.nameAr,
            },
          },
          tx,
        );
        result.created.push(governorate.nameEn);
      }

      if (ring.length < 3) {
        result.missing.push(governorate.nameEn);
        return;
      }

      // Written as text and compared as Postgres prints it, so an unchanged outline doesn't bump updatedAt (and with it
      // the site tree's version).
      const [changed] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "Location" SET "boundary" = ${polygonText(ring)}::polygon, "updatedAt" = now()
        WHERE "id" = ${id}
            AND ("boundary" IS NULL OR "boundary"::text <> (${polygonText(ring)}::polygon)::text)
        RETURNING "id"`;
      if (!changed) {
        result.unchanged.push(governorate.nameEn);
        return;
      }
      await recordAudit(
        {
          action: auditActions.LOCATION_UPDATED,
          entityType: "Location",
          entityId: id,
          after: { boundaryPoints: ring.length, source: "geoBoundaries" },
        },
        tx,
      );
      result.outlined.push(governorate.nameEn);
    });
  }

  return result;
};
