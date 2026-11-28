import {
  carBodies,
  fitsCar,
  type CarBody,
  type TripPin,
  type Quote,
  type QuoteRequest,
  type ResolvedLocation,
} from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { chainsOf, flexibleGovernorate, resolvePin } from "../../location/index";
import { optionKey, pickPrices, walkOrder, type Place } from "../domain/walk";

type Leg = "outbound" | "return";

// A resolved location's chain for the walk: the place itself first, then up to its governorate.
const chainOf = (location: ResolvedLocation): Place[] => [
  { id: location.id, locality: location.locality },
  ...[...location.ancestors].reverse().map(({ id, locality }) => ({ id, locality })),
];

// The prices for a route, per class and body (P1 b): every pair of places the ends sit in, most specific first. Rows
// of archived classes and of deleted places never count.
const pricesBetween = async (
  pickup: readonly Place[],
  dropoff: readonly Place[],
  only: { classId?: string; car?: CarBody } = {},
) => {
  const rows = await prisma.pricing.findMany({
    where: {
      fromId: { in: pickup.map((place) => place.id) },
      toId: { in: dropoff.map((place) => place.id) },
      classId: only.classId,
      car: only.car,
      class: { archivedAt: null },
      from: { deletedAt: null },
      to: { deletedAt: null },
    },
    select: { fromId: true, toId: true, classId: true, car: true, price: true },
  });
  return pickPrices(
    rows.map((row) => ({ ...row, price: row.price.toFixed(2) })),
    walkOrder(pickup, dropoff),
  );
};

const outOfCoverage = (end: "pickup" | "dropoff", leg: Leg) =>
  new AppError({
    code: "OUT_OF_COVERAGE",
    status: 422,
    detail: `The ${end === "pickup" ? "pickup" : "drop-off"}${leg === "return" ? " of the return" : ""} isn't in a place we serve.`,
    extensions: { end, leg },
  });

const notFlexible = (end: "pickup" | "dropoff", leg: Leg) =>
  new AppError({
    code: "LOCATION_NOT_FLEXIBLE",
    status: 422,
    detail: `The ${end === "pickup" ? "pickup" : "drop-off"}${leg === "return" ? " of the return" : ""} names a location that can't be booked as a whole: it isn't a live, flexible governorate.`,
    extensions: { end, leg },
  });

// One end: the flexible governorate it names, or its pin's most specific covered place.
const resolveEnd = async (pin: TripPin, end: "pickup" | "dropoff", leg: Leg) => {
  if (pin.locationId) {
    const governorate = await flexibleGovernorate(pin.locationId);
    if (!governorate) throw notFlexible(end, leg);
    return governorate;
  }
  const location = await resolvePin(pin);
  if (!location) throw outOfCoverage(end, leg);
  return location;
};

// Both pins resolved to their most specific covered places (Q1 a), or to the flexible governorates they name. Both must be covered (B3), and they can't resolve
// to the same place (P3: same resolved location id).
export const resolveRoute = async (pickup: TripPin, dropoff: TripPin, leg: Leg = "outbound") => {
  const [from, to] = await Promise.all([
    resolveEnd(pickup, "pickup", leg),
    resolveEnd(dropoff, "dropoff", leg),
  ]);
  if (from.id === to.id) {
    throw new AppError({
      code: "QUOTE_SAME_PLACE",
      status: 422,
      detail: "The pickup and the drop-off are in the same place.",
      extensions: { leg, locationId: from.id },
    });
  }
  return { pickup: from, dropoff: to };
};

// Every active class with every car body (Q2 a), marked whether the load fits (B4), priced from the price list or null
// when there's no row (price on request, Q3 b). A return leg is priced from the reverse route (P2 a), its pins
// defaulting to the outbound's reversed.
export const quote = async (request: QuoteRequest): Promise<Quote> => {
  const outbound = await resolveRoute(request.pickup, request.dropoff);
  const back = request.return
    ? await resolveRoute(
        request.return.pickup ?? request.dropoff,
        request.return.dropoff ?? request.pickup,
        "return",
      )
    : null;

  const [classes, prices, returnPrices] = await Promise.all([
    prisma.tripClass.findMany({
      where: { archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }, { id: "asc" }],
      select: { id: true, nameEn: true, nameAr: true, descriptionEn: true, descriptionAr: true },
    }),
    pricesBetween(chainOf(outbound.pickup), chainOf(outbound.dropoff)),
    back ? pricesBetween(chainOf(back.pickup), chainOf(back.dropoff)) : null,
  ]);

  return {
    ...outbound,
    return: back,
    options: classes.flatMap((tripClass) =>
      carBodies.map((car) => ({
        class: tripClass,
        car,
        fits: fitsCar(car, request),
        price: prices.get(optionKey(tripClass.id, car)) ?? null,
        returnPrice: returnPrices?.get(optionKey(tripClass.id, car)) ?? null,
      })),
    ),
  };
};

// The current price of one option between two resolved places, for booking to compare with the price the customer saw
// (Q4: expectedPrice, PRICE_CHANGED). Null when there's no price, the class is archived or either place is unknown.
export const priceFor = async ({
  pickupId,
  dropoffId,
  classId,
  car,
}: {
  pickupId: string;
  dropoffId: string;
  classId: string;
  car: CarBody;
}): Promise<string | null> => {
  const chains = await chainsOf([pickupId, dropoffId]);
  const pickup = chains.get(pickupId);
  const dropoff = chains.get(dropoffId);
  if (!pickup || !dropoff) return null;
  const prices = await pricesBetween(pickup, dropoff, { classId, car });
  return prices.get(optionKey(classId, car)) ?? null;
};
