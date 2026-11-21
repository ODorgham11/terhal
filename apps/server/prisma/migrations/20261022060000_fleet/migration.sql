-- CreateEnum
CREATE TYPE "CarBody" AS ENUM ('SEDAN', 'SUV', 'MINIVAN', 'VAN');

-- CreateEnum
CREATE TYPE "DriverTransactionType" AS ENUM ('TRIP_FEE', 'EXPENSE_REIMBURSEMENT', 'CASH_COLLECTED', 'PAYOUT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Office" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "locationId" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Office_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amountOwed" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "licenseNumber" TEXT,
    "licenseExpiresAt" DATE,
    "nationalId" TEXT,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverTransaction" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DriverTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tripId" TEXT,
    "staffId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "plateNumber" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "body" "CarBody" NOT NULL,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "officeId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleImage" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Office_name_key" ON "Office"("name");

-- CreateIndex
CREATE INDEX "Office_archivedAt_idx" ON "Office"("archivedAt");

-- CreateIndex
CREATE INDEX "Office_locationId_idx" ON "Office"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_phone_key" ON "Driver"("phone");

-- CreateIndex
CREATE INDEX "Driver_officeId_idx" ON "Driver"("officeId");

-- CreateIndex
CREATE INDEX "Driver_archivedAt_idx" ON "Driver"("archivedAt");

-- CreateIndex
CREATE INDEX "DriverTransaction_driverId_createdAt_idx" ON "DriverTransaction"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverTransaction_tripId_idx" ON "DriverTransaction"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");

-- CreateIndex
CREATE INDEX "Vehicle_officeId_idx" ON "Vehicle"("officeId");

-- CreateIndex
CREATE INDEX "Vehicle_archivedAt_idx" ON "Vehicle"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleImage_key_key" ON "VehicleImage"("key");

-- CreateIndex
CREATE INDEX "VehicleImage_vehicleId_idx" ON "VehicleImage"("vehicleId");

-- AddForeignKey
ALTER TABLE "Office" ADD CONSTRAINT "Office_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only an external driver or vehicle can come through an office. Prisma can't express this, so the database holds it.
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_office_is_external"
    CHECK ("officeId" IS NULL OR "isExternal");

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_office_is_external"
    CHECK ("officeId" IS NULL OR "isExternal");

-- Each kind of ledger entry moves the balance one way: fees and reimbursements raise what the company owes the driver,
-- cash collected and payouts lower it, an adjustment goes either way but is never zero.
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_sign" CHECK (
    CASE "type"
        WHEN 'TRIP_FEE' THEN "amount" > 0
        WHEN 'EXPENSE_REIMBURSEMENT' THEN "amount" > 0
        WHEN 'CASH_COLLECTED' THEN "amount" < 0
        WHEN 'PAYOUT' THEN "amount" < 0
        ELSE "amount" <> 0
    END
);

-- Entries that come from a trip name it.
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_trip"
    CHECK ("type" NOT IN ('TRIP_FEE', 'EXPENSE_REIMBURSEMENT', 'CASH_COLLECTED') OR "tripId" IS NOT NULL);

-- The ledger is append-only: a mistake is corrected with an adjustment, never by rewriting history.
CREATE FUNCTION "driver_ledger_append_only"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'DriverTransaction is append-only: % is not allowed.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DriverTransaction_append_only_rows"
    BEFORE UPDATE OR DELETE ON "DriverTransaction"
    FOR EACH ROW EXECUTE FUNCTION "driver_ledger_append_only"();

CREATE TRIGGER "DriverTransaction_append_only_truncate"
    BEFORE TRUNCATE ON "DriverTransaction"
    FOR EACH STATEMENT EXECUTE FUNCTION "driver_ledger_append_only"();

-- Driver.amountOwed is the ledger's running total: each entry adds its amount, in the same transaction.
CREATE FUNCTION "driver_ledger_apply"() RETURNS trigger AS $$
BEGIN
    UPDATE "Driver" SET "amountOwed" = "amountOwed" + NEW."amount" WHERE "id" = NEW."driverId";
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DriverTransaction_apply"
    AFTER INSERT ON "DriverTransaction"
    FOR EACH ROW EXECUTE FUNCTION "driver_ledger_apply"();

-- ...and nothing else writes it: a driver starts at zero, and only the ledger's trigger (one trigger level down) may
-- change the balance.
CREATE FUNCTION "driver_amount_owed_from_ledger"() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'INSERT' AND NEW."amountOwed" <> 0)
        OR (TG_OP = 'UPDATE' AND NEW."amountOwed" <> OLD."amountOwed" AND pg_trigger_depth() < 2) THEN
        RAISE EXCEPTION 'Driver_amount_owed_from_ledger: Driver.amountOwed only changes through DriverTransaction.'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'Driver_amount_owed_from_ledger';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Driver_amount_owed_from_ledger"
    BEFORE INSERT OR UPDATE OF "amountOwed" ON "Driver"
    FOR EACH ROW EXECUTE FUNCTION "driver_amount_owed_from_ledger"();

-- A vehicle has at most 5 images, ordered from 0 (the cover).
ALTER TABLE "VehicleImage" ADD CONSTRAINT "VehicleImage_position" CHECK ("position" BETWEEN 0 AND 4);
