-- No whole number the app stores can be negative. Columns already covered elsewhere: Trip's passengers and luggage
-- (Trip_fits_car), the report's mileage (TripReport_mileage), VehicleImage_position, Location_center_valid's radius,
-- AnalyticsDocument's month, year and size, and NotificationDelivery_attempts.

ALTER TABLE "Admin" ADD CONSTRAINT "Admin_totpLastUsedStep_nonnegative"
    CHECK ("totpLastUsedStep" IS NULL OR "totpLastUsedStep" >= 0);

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_verificationAttempts_nonnegative"
    CHECK ("verificationAttempts" >= 0);

ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_verificationAttempts_nonnegative"
    CHECK ("verificationAttempts" >= 0);

-- The same bounds as the contracts' VehicleFields.
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_year_range"
    CHECK ("year" IS NULL OR "year" BETWEEN 1980 AND 2100);

-- Sort orders used to allow -1000 to 1000. Any below zero become zero; ties are broken by name, as before.
UPDATE "TripClass" SET "sortOrder" = 0 WHERE "sortOrder" < 0;
ALTER TABLE "TripClass" ADD CONSTRAINT "TripClass_sortOrder_range"
    CHECK ("sortOrder" BETWEEN 0 AND 1000);
