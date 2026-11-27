import { canServe, fitsCar, tripEventActions, type UpdateTrip } from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import { brandForBooking } from "../../brands/index";
import { resolveRoute } from "../../pricing/index";
import { reportLinkExpiry } from "../domain/report";
import { EDITABLE_STATUSES, PRICE_EDITABLE_STATUSES } from "../domain/rules";
import { changeTrip, type TripFields } from "./events";
import { readTrip } from "./lifecycle";
import { loadDoesNotFit, statusConflict, tripNotFound } from "./shared";

// Staff editing a trip (B10 a): its details while pending or confirmed, its price and payment until it's completed.
// Nothing reprices on its own: a new route, class or body keeps the price until staff change it. Every change is one
// event with each field's before and after.

const PAYMENT_FIELDS = new Set(["paymentMethod", "paidAt"]);
const PRICE_FIELDS = new Set(["totalPrice", ...PAYMENT_FIELDS]);
// Fields that can change until the trip is completed, not only while it's pending or confirmed.
const LATE_FIELDS = new Set([...PRICE_FIELDS, "brandId"]);

const invalid = (path: string, message: string) =>
  validationFailed([{ in: "json", path, code: "custom", message }]);

export const updateTrip = async (id: string, staffId: string, input: UpdateTrip) => {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { vehicle: { select: { body: true } } },
  });
  if (!trip) throw tripNotFound();

  const set: TripFields = {
    pickupDate: input.pickupDate && new Date(input.pickupDate),
    passengers: input.passengers,
    largeLuggage: input.largeLuggage,
    mediumLuggage: input.mediumLuggage,
    smallLuggage: input.smallLuggage,
    car: input.car,
    notes: input.notes,
    clientName: input.clientName,
    clientPhone: input.clientPhone,
    totalPrice: input.totalPrice,
    paymentMethod: input.paymentMethod,
    paidAt: input.paidAt === undefined ? undefined : input.paidAt && new Date(input.paidAt),
  };

  // The report link expires 7 days after the pickup, so it moves with it.
  if (set.pickupDate && trip.reportTokenHash) {
    set.reportTokenExpiresAt = reportLinkExpiry(set.pickupDate as Date);
  }

  // A new pin resolves again, against the other end (covered, not the same place), and takes the new place's names.
  if (input.pickup ?? input.dropoff) {
    const pickupPin = input.pickup ?? {
      latitude: trip.pickupLatitude.toNumber(),
      longitude: trip.pickupLongitude.toNumber(),
    };
    const dropoffPin = input.dropoff ?? {
      latitude: trip.dropoffLatitude.toNumber(),
      longitude: trip.dropoffLongitude.toNumber(),
    };
    const route = await resolveRoute(pickupPin, dropoffPin);
    Object.assign(set, {
      pickupId: route.pickup.id,
      pickupSnapshot: route.pickup.nameEn,
      pickupSnapshotAr: route.pickup.nameAr,
      pickupLatitude: pickupPin.latitude.toFixed(6),
      pickupLongitude: pickupPin.longitude.toFixed(6),
      dropoffId: route.dropoff.id,
      dropoffSnapshot: route.dropoff.nameEn,
      dropoffSnapshotAr: route.dropoff.nameAr,
      dropoffLatitude: dropoffPin.latitude.toFixed(6),
      dropoffLongitude: dropoffPin.longitude.toFixed(6),
    } satisfies TripFields);
  }

  // A brand for the messages still to come. Only a trip staff booked can leave Terhal (Trip_site_brand).
  if (input.brandId !== undefined && input.brandId !== trip.brandId) {
    if (input.brandId !== null && trip.source !== "STAFF") {
      throw invalid("brandId", "A trip booked on the site is always sent under Terhal.");
    }
    set.brandId = (await brandForBooking(input.brandId))?.id ?? null;
  }

  if (input.classId && input.classId !== trip.classId) {
    const tripClass = await prisma.tripClass.findFirst({
      where: { id: input.classId, archivedAt: null },
      select: { nameEn: true, nameAr: true },
    });
    if (!tripClass) throw invalid("classId", "There's no active trip class with this id.");
    set.classId = input.classId;
    set.classSnapshot = { nameEn: tripClass.nameEn, nameAr: tripClass.nameAr };
  }

  const car = input.car ?? trip.car;
  const load = {
    passengers: input.passengers ?? trip.passengers,
    largeLuggage: input.largeLuggage ?? trip.largeLuggage,
    mediumLuggage: input.mediumLuggage ?? trip.mediumLuggage,
    smallLuggage: input.smallLuggage ?? trip.smallLuggage,
  };
  if (!fitsCar(car, load)) throw loadDoesNotFit();
  if (trip.vehicle && !canServe(trip.vehicle.body, car)) {
    throw new AppError({
      code: "VEHICLE_TOO_SMALL",
      status: 422,
      detail: "The assigned vehicle is smaller than this car body. Change the assignment first.",
    });
  }
  const paymentMethod =
    input.paymentMethod === undefined ? trip.paymentMethod : input.paymentMethod;
  const paidAt = input.paidAt === undefined ? trip.paidAt : input.paidAt;
  if (paidAt && !paymentMethod) throw invalid("paymentMethod", "A payment needs its method.");

  const touched = Object.entries(input)
    .filter(([, value]) => (value as unknown) !== undefined)
    .map(([key]) => key);
  const onlyPayment = touched.every((key) => PAYMENT_FIELDS.has(key));

  await prisma.$transaction((tx) =>
    changeTrip(tx, {
      tripId: id,
      actor: { staffId },
      action: onlyPayment ? tripEventActions.PAYMENT_RECORDED : tripEventActions.UPDATED,
      from: PRICE_EDITABLE_STATUSES,
      check: (current) => {
        const details = touched.some((key) => !LATE_FIELDS.has(key));
        if (details && !(EDITABLE_STATUSES as readonly string[]).includes(current.status)) {
          throw statusConflict(
            current.status,
            "Only a pending or confirmed trip's details can change.",
          );
        }
        if (
          input.totalPrice !== undefined &&
          (current.priceState === "REQUESTED" || current.priceState === "PROPOSED")
        ) {
          throw new AppError({
            code: "PRICE_REQUEST_OPEN",
            status: 409,
            detail: "This trip's price is requested or proposed: propose a price instead.",
          });
        }
      },
      set,
    }),
  );
  return readTrip(id);
};
