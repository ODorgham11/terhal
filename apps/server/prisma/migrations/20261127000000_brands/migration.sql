-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Brand_archivedAt_idx" ON "Brand"("archivedAt");

-- Two active brands never share a name, ignoring case and Arabic letter forms, as with trip classes.
CREATE UNIQUE INDEX "Brand_active_nameEn" ON "Brand" (search_normalize("nameEn")) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "Brand_active_nameAr" ON "Brand" (search_normalize("nameAr")) WHERE "archivedAt" IS NULL;

-- At most one brand is the default for staff bookings, and an archived brand never is.
CREATE UNIQUE INDEX "Brand_one_default" ON "Brand" ("isDefault") WHERE "isDefault";
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_default_active" CHECK (NOT ("isDefault" AND "archivedAt" IS NOT NULL));

-- A trip's brand. Added here rather than in the trips migration, which staging and production have already applied.
ALTER TABLE "Trip" ADD COLUMN "brandId" TEXT;

-- CreateIndex
CREATE INDEX "Trip_brandId_idx" ON "Trip"("brandId");

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bookings on the site are always Terhal's: only a trip staff booked can be sent under another brand.
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_site_brand" CHECK ("source" = 'STAFF' OR "brandId" IS NULL);
