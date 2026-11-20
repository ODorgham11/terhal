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
    "radiusMeters" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A governorate's coverage is an outline; a district's or an area's is a center and a radius. Never both, and a district or
-- an area always has its center and radius. Prisma can't express this, so the database holds it.
ALTER TABLE "Location" ADD CONSTRAINT "Location_shape" CHECK (
    ("locality" = 'GOVERNORATE' AND "latitude" IS NULL AND "longitude" IS NULL AND "radiusMeters" IS NULL)
    OR ("locality" <> 'GOVERNORATE' AND "boundary" IS NULL
        AND "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "radiusMeters" IS NOT NULL)
);

ALTER TABLE "Location" ADD CONSTRAINT "Location_center_valid" CHECK (
    "latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180 AND "radiusMeters" > 0
);
