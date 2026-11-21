import { randomInt } from "node:crypto";
import {
  PENDING_TRIP_LIMIT,
  fitsCar,
  tripEventActions,
  type BookTrip,
  type CarBody,
  type Pin,
  type ResolvedLocation,
  type StaffBookTrip,
  type TripPriceState,
} from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { hashToken } from "../../../platform/crypto/tokens";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { validationFailed } from "../../../platform/errors/validation";
import type { Booker } from "../../../platform/http/authenticate";
import { priceFor, resolveRoute } from "../../pricing/index";
import {
  CODE_LENGTH,
  CODE_ALPHABET,
  codeFrom,
  onlinePickupProblem,
  staffPickupProblem,
  type PickupProblem,
} from "../domain/rules";
import { recordTripEvent, type TripActor } from "./events";
import { loadDoesNotFit, tripSelect, tripWriteError, type TripRow } from "./shared";

// Booking (docs/domain-api.md, B and R): on the site by a customer or a verified guest, and in the dashboard by staff.

type Leg = "outbound" | "return";

interface Load {
  passengers: number;
  largeLuggage: number;
  mediumLuggage: number;
  smallLuggage: number;
}

// One trip to create: where, when, and what it costs.
interface LegPlan {
  leg: Leg;
  pickupDate: Date;
  pickupPin: Pin;
  dropoffPin: Pin;
  pickup: ResolvedLocation;
  dropoff: ResolvedLocation;
  totalPrice: string | null;
  priceState: TripPriceState;
}

// Who booked it, as the trip's columns.
type BookerColumns = { customerId: string } | { guestSessionId: string } | { staffId: string };

interface Booking {
  source: "CUSTOMER" | "STAFF";
  booker: BookerColumns;
  actor: TripActor;
  idempotencyKey: string;
  classId: string;
  car: CarBody;
  load: Load;
  clientName: string;
  clientPhone: string;
  notes: string | undefined;
  legs: LegPlan[];
}

const pickupTimeInvalid = (reason: PickupProblem | "BEFORE_OUTBOUND", leg: Leg) => {
  const details: Record<PickupProblem | "BEFORE_OUTBOUND", string> = {
    TOO_SOON: "A pickup must be at least 3 hours from now.",
    TOO_FAR: "A pickup can be at most 90 days from now.",
    OFF_GRID: "A pickup must be on a quarter hour (:00, :15, :30 or :45).",
    IN_PAST: "This pickup time has passed. Mark the booking as backdated to record it.",
    BEFORE_OUTBOUND: "The return must pick up after the outbound trip.",
  };
  return new AppError({
    code: "PICKUP_TIME_INVALID",
    status: 422,
    detail: details[reason],
    extensions: { reason, leg },
  });
};

const priceChanged = (price: string | null, leg: Leg) =>
  new AppError({
    code: "PRICE_CHANGED",
    status: 409,
    detail:
      price === null
        ? "This trip has no price any more: it can be booked on request."
        : `The price is now ${price} EGP.`,
    extensions: { price, leg },
  });

const priceRequired = (leg: Leg) =>
  new AppError({
    code: "PRICE_REQUIRED",
    status: 422,
    detail: "This route has no price. Set one, or book the trip for a customer.",
    extensions: { leg },
  });

// The class must be active: archived classes leave booking (C3).
const assertClassActive = async (classId: string) => {
  const tripClass = await prisma.tripClass.findFirst({
    where: { id: classId, archivedAt: null },
    select: { id: true, nameEn: true, nameAr: true },
  });
  if (!tripClass) {
    throw validationFailed([
      {
        in: "json",
        path: "classId",
        code: "custom",
        message: "There's no active trip class with this id.",
      },
    ]);
  }
  return tripClass;
};

// Both ends of each leg resolved to covered, different places (B3, P3), the return defaulting to the outbound reversed
// (R2 a).
const routes = async (
  input: { pickup: Pin; dropoff: Pin; return?: { pickup?: Pin; dropoff?: Pin } },
  hasReturn: boolean,
) => {
  const outbound = await resolveRoute(input.pickup, input.dropoff);
  const back = hasReturn
    ? {
        pickupPin: input.return?.pickup ?? input.dropoff,
        dropoffPin: input.return?.dropoff ?? input.pickup,
      }
    : null;
  return {
    outbound,
    back: back && { ...back, ...(await resolveRoute(back.pickupPin, back.dropoffPin, "return")) },
  };
};

const currentPrice = (
  classId: string,
  car: CarBody,
  pickup: ResolvedLocation,
  dropoff: ResolvedLocation,
) => priceFor({ pickupId: pickup.id, dropoffId: dropoff.id, classId, car });

// --- Writing ---

const newCode = async (tx: Prisma.TransactionClient) => {
  for (;;) {
    const code = codeFrom(
      Array.from({ length: CODE_LENGTH }, () => randomInt(CODE_ALPHABET.length)),
    );
    if (!(await tx.trip.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
};

const coordinate = (value: number) => value.toFixed(6);

const loadOf = ({ passengers, largeLuggage, mediumLuggage, smallLuggage }: Load): Load => ({
  passengers,
  largeLuggage,
  mediumLuggage,
  smallLuggage,
});

// The booker's pending trips, for the cap (B5): a customer's, or a guest's across every session with the same verified
// email (B11 b).
const pendingCount = (tx: Prisma.TransactionClient, booker: BookerColumns, guestEmail?: string) =>
  tx.trip.count({
    where: {
      status: "PENDING",
      ...("customerId" in booker
        ? { customerId: booker.customerId }
        : { guestSession: { email: guestEmail, verifiedAt: { not: null } } }),
    },
  });

// Serializes bookings by the same booker for the rest of the transaction, so two at once can't both pass the cap. A
// transaction-level advisory lock, which works through the pooler (transaction mode).
const lockBooker = async (tx: Prisma.TransactionClient, key: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booker:${key}`}, 0))`;
};

const findBooking = async (idempotencyKey: string) => {
  const trip = await prisma.trip.findUnique({
    where: { idempotencyKey },
    select: { id: true, subsequentTrip: { select: { id: true } } },
  });
  return trip && { tripId: trip.id, returnTripId: trip.subsequentTrip?.id ?? null };
};

// Creates every leg in one transaction: the return linked to the outbound (R1 a), each with its own code and a
// "created" event. The cap is checked under the booker's lock when one is given.
const create = async (
  booking: Booking,
  cap?: { key: string; guestEmail?: string },
): Promise<{ tripId: string; returnTripId: string | null }> => {
  const tripClass = await assertClassActive(booking.classId);
  const write = () =>
    prisma.$transaction(async (tx) => {
      if (cap) {
        await lockBooker(tx, cap.key);
        const pending = await pendingCount(tx, booking.booker, cap.guestEmail);
        if (pending + booking.legs.length > PENDING_TRIP_LIMIT) {
          throw new AppError({
            code: "PENDING_TRIP_LIMIT",
            status: 409,
            detail: `You can have at most ${String(PENDING_TRIP_LIMIT)} trips waiting for confirmation.`,
            extensions: { limit: PENDING_TRIP_LIMIT, pending },
          });
        }
      }

      const ids: string[] = [];
      for (const plan of booking.legs) {
        const trip = await tx.trip.create({
          data: {
            code: await newCode(tx),
            source: booking.source,
            ...booking.booker,
            classId: tripClass.id,
            classSnapshot: { nameEn: tripClass.nameEn, nameAr: tripClass.nameAr },
            clientName: booking.clientName,
            clientPhone: booking.clientPhone,
            pickupDate: plan.pickupDate,
            car: booking.car,
            ...booking.load,
            totalPrice: plan.totalPrice,
            priceState: plan.priceState,
            notes: booking.notes ?? null,
            idempotencyKey: plan.leg === "outbound" ? booking.idempotencyKey : null,
            pickupId: plan.pickup.id,
            pickupSnapshot: plan.pickup.nameEn,
            pickupSnapshotAr: plan.pickup.nameAr,
            pickupLatitude: coordinate(plan.pickupPin.latitude),
            pickupLongitude: coordinate(plan.pickupPin.longitude),
            dropoffId: plan.dropoff.id,
            dropoffSnapshot: plan.dropoff.nameEn,
            dropoffSnapshotAr: plan.dropoff.nameAr,
            dropoffLatitude: coordinate(plan.dropoffPin.latitude),
            dropoffLongitude: coordinate(plan.dropoffPin.longitude),
            previousTripId: plan.leg === "return" ? (ids[0] ?? null) : null,
          },
          select: { id: true },
        });
        ids.push(trip.id);
        await recordTripEvent(tx, {
          tripId: trip.id,
          actor: booking.actor,
          action: tripEventActions.CREATED,
          data: {
            to: "PENDING",
            source: booking.source,
            priceState: plan.priceState,
            totalPrice: plan.totalPrice,
            ...(plan.leg === "return" && { previousTripId: ids[0] ?? null }),
          },
        });
      }
      return { tripId: ids[0] ?? "", returnTripId: ids[1] ?? null };
    });

  try {
    return await write();
  } catch (error) {
    // A retry of the same booking that got here at the same moment: hand back the one that won.
    if (violatedUniqueIndex(error) === "Trip_idempotencyKey_key") {
      const existing = await findBooking(booking.idempotencyKey);
      if (existing) return existing;
    }
    return tripWriteError(error);
  }
};

export const readBooking = async ({
  tripId,
  returnTripId,
}: {
  tripId: string;
  returnTripId: string | null;
}): Promise<{ trip: TripRow; returnTrip: TripRow | null }> => {
  const rows = await prisma.trip.findMany({
    where: { id: { in: returnTripId ? [tripId, returnTripId] : [tripId] } },
    select: tripSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const trip = byId.get(tripId);
  if (!trip) throw new Error(`Booked trip ${tripId} is missing.`);
  return { trip, returnTrip: returnTripId ? (byId.get(returnTripId) ?? null) : null };
};

// The key the trip stores: the client's Idempotency-Key, hashed with who sent it, so two bookers' keys never collide.
const idempotencyHash = (scope: string, key: string) => hashToken(`${scope}:${key}`);

// --- On the site ---

// A customer or a verified guest booking (B1-B9, R1-R2, Q3, Q4). A repeat of the same Idempotency-Key by the same booker
// returns the first booking (`replayed`).
export const bookOnline = async (
  input: BookTrip,
  booker: Booker,
  key: string,
  now = new Date(),
) => {
  const who =
    "customerId" in booker
      ? await prisma.customer.findUniqueOrThrow({
          where: { id: booker.customerId },
          select: { id: true, firstName: true, lastName: true, phone: true },
        })
      : await prisma.guestSession.findUniqueOrThrow({
          where: { id: booker.guestSessionId },
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        });
  const guestEmail = "email" in who ? String(who.email) : undefined;
  const idempotencyKey = idempotencyHash(
    "customerId" in booker ? `customer:${who.id}` : `guest:${who.id}`,
    key,
  );
  const replay = await findBooking(idempotencyKey);
  if (replay) return { ...(await readBooking(replay)), replayed: true };

  const pickupDate = new Date(input.pickupDate);
  const outboundProblem = onlinePickupProblem(pickupDate, now);
  if (outboundProblem) throw pickupTimeInvalid(outboundProblem, "outbound");
  const returnDate = input.return ? new Date(input.return.pickupDate) : null;
  if (returnDate) {
    const problem = onlinePickupProblem(returnDate, now);
    if (problem) throw pickupTimeInvalid(problem, "return");
    if (returnDate <= pickupDate) throw pickupTimeInvalid("BEFORE_OUTBOUND", "return");
  }

  if (!fitsCar(input.car, input)) throw loadDoesNotFit();
  const { outbound, back } = await routes(input, input.return !== undefined);

  // Q4 a: the price is recomputed and must be the one the booker saw; an option without one is booked on request.
  const legs: LegPlan[] = [];
  const outboundPrice = await currentPrice(
    input.classId,
    input.car,
    outbound.pickup,
    outbound.dropoff,
  );
  if (outboundPrice !== (input.expectedPrice ?? null))
    throw priceChanged(outboundPrice, "outbound");
  legs.push({
    leg: "outbound",
    pickupDate,
    pickupPin: input.pickup,
    dropoffPin: input.dropoff,
    ...outbound,
    totalPrice: outboundPrice,
    priceState: outboundPrice === null ? "REQUESTED" : "QUOTED",
  });
  if (back && returnDate) {
    const returnPrice = await currentPrice(input.classId, input.car, back.pickup, back.dropoff);
    if (returnPrice !== (input.return?.expectedPrice ?? null))
      throw priceChanged(returnPrice, "return");
    legs.push({
      leg: "return",
      pickupDate: returnDate,
      ...back,
      totalPrice: returnPrice,
      priceState: returnPrice === null ? "REQUESTED" : "QUOTED",
    });
  }

  const booked = await create(
    {
      source: "CUSTOMER",
      booker: booker,
      actor: booker,
      idempotencyKey,
      classId: input.classId,
      car: input.car,
      load: loadOf(input),
      clientName: input.clientName ?? `${who.firstName} ${who.lastName}`,
      clientPhone: input.clientPhone ?? who.phone,
      notes: input.notes,
      legs,
    },
    guestEmail ? { key: `guest:${guestEmail}`, guestEmail } : { key: `customer:${who.id}` },
  );
  return { ...(await readBooking(booked)), replayed: false };
};

// --- In the dashboard ---

const customerNotAvailable = () =>
  new AppError({
    code: "CUSTOMER_NOT_AVAILABLE",
    status: 422,
    detail: "There's no active customer with this id.",
  });

// Staff booking (B6 a): for an existing customer, who is then the booker (source STAFF, the staff member the event's
// actor), or on their own. Staff choose the price or take the price list's; only a customer's trip can wait for one
// (Q3 follow-ups). Any future time, and the past when backdated.
export const bookByStaff = async (
  input: StaffBookTrip,
  staffId: string,
  key: string,
  now = new Date(),
) => {
  const idempotencyKey = idempotencyHash(`staff:${staffId}`, key);
  const replay = await findBooking(idempotencyKey);
  if (replay) return { ...(await readBooking(replay)), replayed: true };

  const customer = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, status: "ACTIVE" },
        select: { id: true, firstName: true, lastName: true, phone: true },
      })
    : null;
  if (input.customerId && !customer) throw customerNotAvailable();

  const clientName = input.clientName ?? (customer && `${customer.firstName} ${customer.lastName}`);
  const clientPhone = input.clientPhone ?? customer?.phone;
  if (!clientName || !clientPhone) {
    throw validationFailed(
      [
        !clientName && { path: "clientName", message: "Passenger name is required." },
        !clientPhone && { path: "clientPhone", message: "Passenger phone is required." },
      ]
        .filter((issue) => issue !== false)
        .map((issue) => ({ in: "json" as const, code: "custom", ...issue })),
    );
  }

  const pickupDate = new Date(input.pickupDate);
  const outboundProblem = staffPickupProblem(pickupDate, now, input.backdated);
  if (outboundProblem) throw pickupTimeInvalid(outboundProblem, "outbound");
  const returnDate = input.return ? new Date(input.return.pickupDate) : null;
  if (returnDate) {
    const problem = staffPickupProblem(returnDate, now, input.backdated);
    if (problem) throw pickupTimeInvalid(problem, "return");
    if (returnDate <= pickupDate) throw pickupTimeInvalid("BEFORE_OUTBOUND", "return");
  }

  if (!fitsCar(input.car, input)) throw loadDoesNotFit();
  const { outbound, back } = await routes(input, input.return !== undefined);

  const priceOf = async (
    given: string | undefined,
    pickup: ResolvedLocation,
    dropoff: ResolvedLocation,
    leg: Leg,
  ) => {
    const price = given ?? (await currentPrice(input.classId, input.car, pickup, dropoff));
    if (price === null && !customer) throw priceRequired(leg);
    return { totalPrice: price, priceState: price === null ? "REQUESTED" : "QUOTED" } as const;
  };

  const legs: LegPlan[] = [
    {
      leg: "outbound",
      pickupDate,
      pickupPin: input.pickup,
      dropoffPin: input.dropoff,
      ...outbound,
      ...(await priceOf(input.totalPrice, outbound.pickup, outbound.dropoff, "outbound")),
    },
  ];
  if (back && returnDate) {
    legs.push({
      leg: "return",
      pickupDate: returnDate,
      ...back,
      ...(await priceOf(input.return?.totalPrice, back.pickup, back.dropoff, "return")),
    });
  }

  const booked = await create({
    source: "STAFF",
    booker: customer ? { customerId: customer.id } : { staffId },
    actor: { staffId },
    idempotencyKey,
    classId: input.classId,
    car: input.car,
    load: loadOf(input),
    clientName,
    clientPhone,
    notes: input.notes,
    legs,
  });
  return { ...(await readBooking(booked)), replayed: false };
};
