-- CreateEnum
CREATE TYPE "TripSource" AS ENUM ('CUSTOMER', 'STAFF');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PENDING', 'CANCELLED', 'CONFIRMED', 'IN_PROGRESS', 'AWAITING_REPORT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CarBody" AS ENUM ('SEDAN', 'SUV', 'MINIVAN', 'VAN');

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('INTERCITY_TOLL', 'FUEL', 'CAR_MAINTENANCE', 'DRIVER_FEE', 'OTHER');

-- CreateTable
CREATE TABLE "TripClass" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
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
    "totalPrice" DECIMAL(12,2) NOT NULL,
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
    "staffId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
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
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
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
CREATE UNIQUE INDEX "Trip_previousTripId_key" ON "Trip"("previousTripId");

-- CreateIndex
CREATE INDEX "Trip_status_pickupDate_idx" ON "Trip"("status", "pickupDate");

-- CreateIndex
CREATE INDEX "Trip_customerId_idx" ON "Trip"("customerId");

-- CreateIndex
CREATE INDEX "Trip_driverId_idx" ON "Trip"("driverId");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_idx" ON "TripEvent"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripReport_tripId_key" ON "TripReport"("tripId");

-- CreateIndex
CREATE INDEX "TripStop_reportId_idx" ON "TripStop"("reportId");

-- CreateIndex
CREATE INDEX "TripExpense_reportId_idx" ON "TripExpense"("reportId");

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
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripReport" ADD CONSTRAINT "TripReport_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TripReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripExpense" ADD CONSTRAINT "TripExpense_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TripReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
