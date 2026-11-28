-- A flexible governorate can be booked as a whole: "Alexandria" as a trip's pickup or drop-off, the exact spot agreed
-- with the client by the driver. Only a governorate with its outline can be (the outline's centre pins such a trip on a
-- map); districts and areas are always bookable by their centre, so the flag means nothing for them and stays off.
ALTER TABLE "Location" ADD COLUMN "flexible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Location" ADD CONSTRAINT "Location_flexible" CHECK (
    NOT "flexible" OR ("locality" = 'GOVERNORATE' AND "boundary" IS NOT NULL)
);
