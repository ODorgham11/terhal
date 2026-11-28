-- A report runs the way a trip does: the car is taken at or before the pickup, the passenger is dropped off after the
-- pickup, and the car goes back after the drop-off.
ALTER TABLE "TripReport" DROP CONSTRAINT "TripReport_chronology";
ALTER TABLE "TripReport" ADD CONSTRAINT "TripReport_chronology"
    CHECK ("startedAt" <= "pickupAt" AND "pickupAt" < "dropoffAt" AND "dropoffAt" < "endedAt");
