-- CreateEnum
CREATE TYPE "TripSource" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PENDING', 'CANCELLED', 'CONFIRMED', 'IN_PROGRESS', 'AWAITING_REPORT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TripPriceState" AS ENUM ('QUOTED', 'REQUESTED', 'PROPOSED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_TO_DRIVER', 'CASH_AT_OFFICE', 'TRANSFER', 'CARD');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('INTERCITY_TOLL', 'FUEL', 'CAR_MAINTENANCE', 'DRIVER_FEE', 'OFFICE_FEE', 'OTHER');

-- CreateTable
CREATE TABLE "TripClass" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" "TripSource" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PENDING',
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "staffId" TEXT,
    "driverId" TEXT,
    "vehicleId" TEXT,
    "officeId" TEXT,
    "classId" TEXT NOT NULL,
    "classSnapshot" JSONB NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT NOT NULL,
    "pickupDate" TIMESTAMP(3) NOT NULL,
    "smallLuggage" INTEGER NOT NULL,
    "mediumLuggage" INTEGER NOT NULL,
    "largeLuggage" INTEGER NOT NULL,
    "passengers" INTEGER NOT NULL,
    "car" "CarBody" NOT NULL,
    "totalPrice" DECIMAL(12,2),
    "priceState" "TripPriceState" NOT NULL DEFAULT 'QUOTED',
    "paymentMethod" "PaymentMethod",
    "paidAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "reportTokenHash" TEXT,
    "reportTokenExpiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "pickupId" TEXT NOT NULL,
    "pickupSnapshot" TEXT NOT NULL,
    "pickupLatitude" DECIMAL(9,6) NOT NULL,
    "pickupLongitude" DECIMAL(9,6) NOT NULL,
    "dropoffId" TEXT NOT NULL,
    "dropoffSnapshot" TEXT NOT NULL,
    "dropoffLatitude" DECIMAL(9,6) NOT NULL,
    "dropoffLongitude" DECIMAL(9,6) NOT NULL,
    "previousTripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" TEXT NOT NULL,
    "staffId" TEXT,
    "customerId" TEXT,
    "guestSessionId" TEXT,
    "system" TEXT,
    "tripId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripReport" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "vehiclePickup" TEXT NOT NULL,
    "startMileage" INTEGER NOT NULL,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "dropoffAt" TIMESTAMP(3) NOT NULL,
    "vehicleDropoff" TEXT NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "endMileage" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripStop" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "locationId" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripExpense" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "type" "ExpenseType" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "TripExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripClass_archivedAt_idx" ON "TripClass"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_code_key" ON "Trip"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_idempotencyKey_key" ON "Trip"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_reportTokenHash_key" ON "Trip"("reportTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_previousTripId_key" ON "Trip"("previousTripId");

-- CreateIndex
CREATE INDEX "Trip_status_pickupDate_idx" ON "Trip"("status", "pickupDate");

-- CreateIndex
CREATE INDEX "Trip_customerId_idx" ON "Trip"("customerId");

-- CreateIndex
CREATE INDEX "Trip_driverId_idx" ON "Trip"("driverId");

-- CreateIndex
CREATE INDEX "Trip_officeId_idx" ON "Trip"("officeId");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_idx" ON "TripEvent"("tripId");

-- CreateIndex
CREATE INDEX "TripEvent_customerId_idx" ON "TripEvent"("customerId");

-- CreateIndex
CREATE INDEX "TripEvent_guestSessionId_idx" ON "TripEvent"("guestSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TripReport_tripId_key" ON "TripReport"("tripId");

-- CreateIndex
CREATE INDEX "TripStop_reportId_idx" ON "TripStop"("reportId");

-- CreateIndex
CREATE INDEX "TripExpense_reportId_idx" ON "TripExpense"("reportId");

-- AddForeignKey
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TripClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_pickupId_fkey" FOREIGN KEY ("pickupId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_dropoffId_fkey" FOREIGN KEY ("dropoffId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_previousTripId_fkey" FOREIGN KEY ("previousTripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripReport" ADD CONSTRAINT "TripReport_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TripReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TripReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A trip is booked by exactly one of a customer, a guest and a staff member. Prisma can't express this, so the database holds it.
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_one_booker"
    CHECK (num_nonnulls("customerId", "guestSessionId", "staffId") = 1);

-- A trip event's actor is exactly one of a staff member, a customer, a guest and the system (a background job, named in "system").
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_one_actor"
    CHECK (num_nonnulls("staffId", "customerId", "guestSessionId", "system") = 1);

-- A trip's price is empty exactly while it's requested, and a trip can't go past pending until its price is one the
-- booker has seen and accepted (quoted at booking, or a proposal they accepted).
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_price_state"
    CHECK (("totalPrice" IS NULL) = ("priceState" = 'REQUESTED'));
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_priced_before_confirmed"
    CHECK ("status" IN ('PENDING', 'CANCELLED') OR "priceState" IN ('QUOTED', 'ACCEPTED'));

-- Amounts are Egyptian pounds, positive and below a sanity cap.
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_price_positive"
    CHECK ("totalPrice" IS NULL OR ("totalPrice" > 0 AND "totalPrice" <= 1000000));
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_amount_positive"
    CHECK ("amount" > 0 AND "amount" <= 1000000);

-- A payment date needs a method.
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_paid_with_method"
    CHECK ("paidAt" IS NULL OR "paymentMethod" IS NOT NULL);

-- The driver's report link: a token hash and its expiry, together.
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_report_token"
    CHECK (("reportTokenHash" IS NULL) = ("reportTokenExpiresAt" IS NULL));

-- Passengers and luggage must fit the car body. The same limits are carCapacity in @terhal/contracts; a test keeps the
-- two in step. PLACEHOLDER numbers until the client gives the real ones.
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_fits_car" CHECK (
    "passengers" >= 1 AND "smallLuggage" >= 0 AND "mediumLuggage" >= 0 AND "largeLuggage" >= 0
    AND CASE "car"
        WHEN 'SEDAN' THEN "passengers" <= 4 AND "largeLuggage" <= 2 AND "mediumLuggage" <= 1 AND "smallLuggage" <= 2
        WHEN 'SUV' THEN "passengers" <= 6 AND "largeLuggage" <= 3 AND "mediumLuggage" <= 2 AND "smallLuggage" <= 3
        WHEN 'MINIVAN' THEN "passengers" <= 7 AND "largeLuggage" <= 4 AND "mediumLuggage" <= 3 AND "smallLuggage" <= 4
        WHEN 'VAN' THEN "passengers" <= 14 AND "largeLuggage" <= 8 AND "mediumLuggage" <= 6 AND "smallLuggage" <= 8
    END
);

-- A driver or a vehicle is on at most one trip in progress. Prisma can't express partial indexes.
CREATE UNIQUE INDEX "Trip_one_in_progress_per_driver" ON "Trip" ("driverId") WHERE "status" = 'IN_PROGRESS';
CREATE UNIQUE INDEX "Trip_one_in_progress_per_vehicle" ON "Trip" ("vehicleId") WHERE "status" = 'IN_PROGRESS';

-- A trip handed to an office may name a driver and a vehicle, but only ones that come through that office.
CREATE FUNCTION "trip_assignment_matches_office"() RETURNS trigger AS $$
BEGIN
    IF NEW."officeId" IS NOT NULL AND (
        (NEW."driverId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Driver" WHERE "id" = NEW."driverId" AND "officeId" = NEW."officeId"))
        OR (NEW."vehicleId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Vehicle" WHERE "id" = NEW."vehicleId" AND "officeId" = NEW."officeId"))
    ) THEN
        RAISE EXCEPTION 'Trip_assignment_matches_office: a trip handed to an office can only have that office''s driver and vehicle.'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'Trip_assignment_matches_office';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Trip_assignment_matches_office"
    BEFORE INSERT OR UPDATE OF "officeId", "driverId", "vehicleId" ON "Trip"
    FOR EACH ROW EXECUTE FUNCTION "trip_assignment_matches_office"();

-- Two active classes never share a name in either language; archived ones can.
CREATE UNIQUE INDEX "TripClass_active_nameEn" ON "TripClass" (search_normalize("nameEn")) WHERE "archivedAt" IS NULL;
CREATE UNIQUE INDEX "TripClass_active_nameAr" ON "TripClass" (search_normalize("nameAr")) WHERE "archivedAt" IS NULL;

-- A driver's report runs in order: start, pickup, drop-off, end, and the odometer never goes back.
ALTER TABLE "TripReport" ADD CONSTRAINT "TripReport_chronology"
    CHECK ("startedAt" <= "pickupAt" AND "pickupAt" <= "dropoffAt" AND "dropoffAt" <= "endedAt");
ALTER TABLE "TripReport" ADD CONSTRAINT "TripReport_mileage"
    CHECK ("startMileage" >= 0 AND "endMileage" >= "startMileage");

-- A stop is an address or a pin (both coordinates), exactly one of them, and ends after it starts.
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_address_or_pin" CHECK (
    num_nonnulls("address", "latitude") = 1 AND (("latitude" IS NULL) = ("longitude" IS NULL))
);
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_times" CHECK ("startedAt" <= "endedAt");
