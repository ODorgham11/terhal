import { z } from "zod";
import { CarBody } from "./cars";
import { ResolvedLocation, TripPin } from "./locations";

// A quote: what every active class and car body costs between two pins (docs/domains.md, section Q). Stateless:
// booking recomputes the price and compares it with the one the customer saw (Q4).

const Count = (label: string, min: number) =>
  z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${String(min)}.`)
    .max(50, `${label} must be 50 at most.`);

export const QuoteRequest = z
  .object({
    pickup: TripPin,
    dropoff: TripPin,
    passengers: Count("Passengers", 1),
    largeLuggage: Count("Large luggage", 0).default(0),
    mediumLuggage: Count("Medium luggage", 0).default(0),
    smallLuggage: Count("Small luggage", 0).default(0),
    return: z.object({ pickup: TripPin.optional(), dropoff: TripPin.optional() }).optional().meta({
      description:
        "Also price a return leg. Its pins default to the outbound's, reversed; give them when the return starts or ends elsewhere.",
    }),
  })
  .meta({ id: "QuoteRequest" });
export type QuoteRequest = z.output<typeof QuoteRequest>;

export const QuoteOption = z
  .object({
    class: z.object({
      id: z.string(),
      nameEn: z.string(),
      nameAr: z.string(),
      descriptionEn: z.string().nullable(),
      descriptionAr: z.string().nullable(),
    }),
    car: CarBody,
    fits: z
      .boolean()
      .meta({ description: "Whether the passengers and luggage fit in this car body." }),
    price: z.string().nullable().meta({
      example: "1250.00",
      description: "EGP. Null when the route has no price: bookable on request.",
    }),
    returnPrice: z.string().nullable().meta({
      description:
        "The return leg's price, from the reverse route. Null without a return or a price.",
    }),
  })
  .meta({ id: "QuoteOption" });
export type QuoteOption = z.infer<typeof QuoteOption>;

const Leg = z.object({ pickup: ResolvedLocation, dropoff: ResolvedLocation });

export const Quote = z
  .object({
    pickup: ResolvedLocation,
    dropoff: ResolvedLocation,
    return: Leg.nullable(),
    options: z.array(QuoteOption).meta({
      description:
        "Every active class with every car body, classes in display order, bodies smallest first.",
    }),
  })
  .meta({ id: "Quote" });
export type Quote = z.infer<typeof Quote>;
