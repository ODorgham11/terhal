-- CreateEnum
CREATE TYPE "Locality" AS ENUM ('GOVERNORATE', 'DISTRICT', 'AREA');

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "locality" "Locality" NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "boundary" polygon,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "radius" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "deletedWithId" TEXT,
    "search" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE INDEX "Location_deletedWithId_idx" ON "Location"("deletedWithId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_deletedWithId_fkey" FOREIGN KEY ("deletedWithId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A governorate's coverage is an outline; a district's or an area's is a center and a radius. Never both, and a district or
-- an area always has its center and radius. Prisma can't express this, so the database holds it.
ALTER TABLE "Location" ADD CONSTRAINT "Location_shape" CHECK (
    ("locality" = 'GOVERNORATE' AND "latitude" IS NULL AND "longitude" IS NULL AND "radius" IS NULL)
    OR ("locality" <> 'GOVERNORATE' AND "boundary" IS NULL
        AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "radius" IS NOT NULL)
);

ALTER TABLE "Location" ADD CONSTRAINT "Location_center_valid" CHECK (
    "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "radius" > 0
);

-- Search text: lower case, Arabic diacritics and tatweel removed, alef forms, taa marbuta and alef maqsura folded, Arabic
-- digits turned Western, spaces collapsed. So "الإسكندرية" matches "الاسكندريه", and "٠١٠" matches "010". The web app's
-- normalizeSearch (@terhal/contracts) does the same to what people type; a test keeps the two in step. Used by the
-- search columns (filled by triggers) and the unique names below.
CREATE FUNCTION "search_normalize"(value text) RETURNS text AS $$
    SELECT btrim(regexp_replace(
        translate(
            regexp_replace(lower(value), '[ً-ْٰـ]', '', 'g'),
            'أإآٱةى٠١٢٣٤٥٦٧٨٩',
            'ااااهي0123456789'
        ),
        '\s+', ' ', 'g'
    ))
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

CREATE FUNCTION "location_search"() RETURNS trigger AS $$
BEGIN
    NEW."search" := search_normalize(NEW."nameEn" || ' ' || NEW."nameAr");
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Location_search"
    BEFORE INSERT OR UPDATE OF "nameEn", "nameAr", "search" ON "Location"
    FOR EACH ROW EXECUTE FUNCTION "location_search"();

-- A deleted location records which delete removed it (itself, or the ancestor whose delete cascaded to it), so a restore
-- brings back exactly that subtree.
ALTER TABLE "Location" ADD CONSTRAINT "Location_deleted_with"
    CHECK (("deletedAt" IS NULL) = ("deletedWithId" IS NULL));

-- The tree only narrows: a governorate is at the top, a district sits in a governorate, an area in a district or directly
-- in a governorate. A location's locality never changes, so moving a parent can't break its children.
CREATE FUNCTION "location_parent_broader"() RETURNS trigger AS $$
DECLARE
    parent_locality "Locality";
BEGIN
    IF TG_OP = 'UPDATE' AND NEW."locality" <> OLD."locality" THEN
        RAISE EXCEPTION 'Location_parent_broader: a location''s locality can''t change.'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'Location_parent_broader';
    END IF;

    IF NEW."parentId" IS NOT NULL THEN
        SELECT "locality" INTO parent_locality FROM "Location" WHERE "id" = NEW."parentId";
    END IF;

    -- coalesce: with no parent, parent_locality is null and the comparisons below are null, not false.
    IF NOT coalesce(
        (NEW."locality" = 'GOVERNORATE' AND NEW."parentId" IS NULL)
        OR (NEW."locality" = 'DISTRICT' AND parent_locality = 'GOVERNORATE')
        OR (NEW."locality" = 'AREA' AND parent_locality IN ('GOVERNORATE', 'DISTRICT')),
        false
    ) THEN
        RAISE EXCEPTION 'Location_parent_broader: a % can''t sit in a %.', NEW."locality", coalesce(parent_locality::text, 'top level')
            USING ERRCODE = 'check_violation', CONSTRAINT = 'Location_parent_broader';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Location_parent_broader"
    BEFORE INSERT OR UPDATE OF "parentId", "locality" ON "Location"
    FOR EACH ROW EXECUTE FUNCTION "location_parent_broader"();

-- Two live places with the same name (in either language) in the same parent are always a mistake. The same name in
-- different parents is fine. Prisma can't express partial or expression indexes, so they live here.
CREATE UNIQUE INDEX "Location_live_sibling_nameEn" ON "Location" (coalesce("parentId", ''), search_normalize("nameEn"))
    WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Location_live_sibling_nameAr" ON "Location" (coalesce("parentId", ''), search_normalize("nameAr"))
    WHERE "deletedAt" IS NULL;
