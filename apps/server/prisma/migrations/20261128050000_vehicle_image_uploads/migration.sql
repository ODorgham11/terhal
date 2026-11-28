-- Photos uploaded straight to storage on a signed link, waiting to be confirmed.
CREATE TABLE "VehicleImageUpload" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleImageUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VehicleImageUpload_key_key" ON "VehicleImageUpload"("key");
CREATE INDEX "VehicleImageUpload_vehicleId_idx" ON "VehicleImageUpload"("vehicleId");
CREATE INDEX "VehicleImageUpload_expiresAt_idx" ON "VehicleImageUpload"("expiresAt");

ALTER TABLE "VehicleImageUpload" ADD CONSTRAINT "VehicleImageUpload_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleImageUpload" ADD CONSTRAINT "VehicleImageUpload_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An image's type and size, as the link was signed for: JPEG, PNG or WebP, 5 MB at most.
ALTER TABLE "VehicleImageUpload" ADD CONSTRAINT "VehicleImageUpload_size"
    CHECK ("size" > 0 AND "size" <= 5242880);
ALTER TABLE "VehicleImageUpload" ADD CONSTRAINT "VehicleImageUpload_content_type"
    CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp'));
