-- A national ID is an Egyptian one: exactly 14 digits.
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_national_id_format"
    CHECK ("nationalId" IS NULL OR "nationalId" ~ '^[0-9]{14}$');

-- One driver per national ID and per licence, archived ones included (as with the phone): an archived driver comes
-- back by restoring them, not by adding them again. Licence numbers match whatever their case.
CREATE UNIQUE INDEX "Driver_nationalId_key" ON "Driver"("nationalId");
CREATE UNIQUE INDEX "Driver_licenseNumber_key" ON "Driver"(lower("licenseNumber"));
