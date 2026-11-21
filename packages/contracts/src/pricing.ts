import { z } from "zod";
import { CarBody } from "./cars";
import { Locality } from "./locations";

// The price list: a fixed price for one direction of a route, per trip class and car body (docs/domain-api.md, section
// P). A quote walks up the location tree to find the most specific row, so "Cairo → Alexandria" covers every place in
// both unless a more specific row overrides it.

// The most a price can be, in EGP. The database holds the same cap (Pricing_price_positive).
export const MAX_PRICE = 1_000_000;

// Egyptian pounds as a decimal string, always with two places: "1250.00" (X3). Accepts "1250" or "1250.5" too.
export const Price = z
  .string({ error: 'Price must be a decimal string, e.g. "1250.00".' })
  .trim()
  .pipe(
    z
      .string()
      .regex(/^\d{1,7}(\.\d{1,2})?$/, "Price must be a number of pounds with at most 2 decimals."),
  )
  .transform((value) => Number(value).toFixed(2))
  .refine((value) => Number(value) > 0, "Price must be more than 0.")
  .refine((value) => Number(value) <= MAX_PRICE, "Price must be 1,000,000 at most.")
  .meta({ id: "Price", example: "1250.00", description: "EGP, two decimals." });

const Id = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must contain 100 characters at most.`);

// The ends of a route and a class, named, with whether they still count for quotes.
const PricingPlace = z.object({
  id: z.string(),
  locality: Locality,
  nameEn: z.string(),
  nameAr: z.string(),
  deleted: z.boolean(),
});

export const PricingRow = z
  .object({
    id: z.string(),
    from: PricingPlace,
    to: PricingPlace,
    class: z.object({
      id: z.string(),
      nameEn: z.string(),
      nameAr: z.string(),
      archived: z.boolean(),
    }),
    car: CarBody,
    price: z.string().meta({ example: "1250.00" }),
    active: z.boolean().meta({
      description: "False while its class is archived or either place is deleted: quotes skip it.",
    }),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "PricingRow" });
export type PricingRow = z.infer<typeof PricingRow>;

export const ListPricing = z.object({
  fromId: Id("From").optional(),
  toId: Id("To").optional(),
  classId: Id("Class").optional(),
  car: CarBody.optional(),
  q: z
    .string()
    .trim()
    .max(100, "Search must contain 100 characters at most.")
    .optional()
    .meta({ description: "Matches either end's names." }),
  limit: z.coerce
    .number({ error: "Limit must be a number." })
    .int("Limit must be a whole number.")
    .min(1, "Limit must be at least 1.")
    .max(200, "Limit must be 200 at most.")
    .default(50),
  // The id of the last row on the current page. The next page starts right after it.
  cursor: Id("Cursor").optional(),
});
export type ListPricing = z.output<typeof ListPricing>;

// One price for a route. An area can't be priced to itself (P3: a trip within one area isn't bookable), but a district
// or a governorate can ("Cairo → Cairo" covers trips across Cairo).
export const PricingEntry = z.object({
  fromId: Id("From"),
  toId: Id("To"),
  classId: Id("Class"),
  car: CarBody,
  price: Price,
});
export type PricingEntry = z.output<typeof PricingEntry>;

export const CreatePricing = PricingEntry.extend({
  bothWays: z
    .boolean({ error: "Both ways must be true or false." })
    .default(false)
    .meta({ description: "Also add the reverse direction at the same price." }),
}).meta({ id: "CreatePricing" });
export type CreatePricing = z.output<typeof CreatePricing>;

export const PricingCreated = z
  .object({ data: z.array(PricingRow).meta({ description: "One row, or two with bothWays." }) })
  .meta({ id: "PricingCreated" });

export const UpdatePricing = z.object({ price: Price }).meta({ id: "UpdatePricing" });

// A bulk upload, e.g. from an edited export: every row is added, or updated if its route, class and body already have a
// price. All or nothing.
export const BULK_PRICING_LIMIT = 500;
export const BulkPricing = z
  .object({
    rows: z
      .array(PricingEntry)
      .min(1, "Send at least one row.")
      .max(BULK_PRICING_LIMIT, `Send ${String(BULK_PRICING_LIMIT)} rows at most.`),
  })
  .meta({ id: "BulkPricing" });
export type BulkPricing = z.output<typeof BulkPricing>;

export const BulkPricingResult = z
  .object({ created: z.int(), updated: z.int(), unchanged: z.int() })
  .meta({ id: "BulkPricingResult" });
export type BulkPricingResult = z.infer<typeof BulkPricingResult>;
