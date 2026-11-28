import { z } from "zod";

// Trip classes, e.g. "Economy" and "VIP": what's included in a ride. Prices are set per class (docs/domains.md,
// section C). Archived classes leave quotes and booking; their prices stay and come back on restore.

const ClassName = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} must contain at least 2 letters.`)
    .max(50, `${label} must contain 50 letters at most.`);

// Empty text clears a description.
const Description = (label: string) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(500, `${label} must contain 500 characters at most.`)
    .transform((value) => value || null)
    .nullable();

const SortOrder = z
  .number({ error: "Sort order must be a number." })
  .int("Sort order must be a whole number.")
  .min(0, "Sort order can't be negative.")
  .max(1000, "Sort order must be 1000 at most.")
  .meta({ description: "Lower comes first on the site." });

export const TripClass = z
  .object({
    id: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    descriptionEn: z.string().nullable(),
    descriptionAr: z.string().nullable(),
    sortOrder: z.int(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "TripClass" });
export type TripClass = z.infer<typeof TripClass>;

// What the customer site shows of an active class.
// A row of the staff list: the class plus how much it's used, for deciding what archiving it touches.
export const StaffTripClass = TripClass.extend({
  prices: z.int().meta({ description: "Price rows for this class." }),
  tripsThisMonth: z.int().meta({
    description: "Trips picked up this Cairo month in this class, cancelled ones left out.",
  }),
}).meta({ id: "StaffTripClass" });
export type StaffTripClass = z.infer<typeof StaffTripClass>;

export const SiteTripClass = TripClass.omit({ archivedAt: true }).meta({ id: "SiteTripClass" });
export type SiteTripClass = z.infer<typeof SiteTripClass>;

export const ListTripClasses = z.object({
  archived: z
    .enum(["true", "false"], { error: "Archived must be true or false." })
    .transform((value) => value === "true")
    .default(false)
    .meta({ description: "true lists only archived classes." }),
});

export const CreateTripClass = z
  .object({
    nameEn: ClassName("English name"),
    nameAr: ClassName("Arabic name"),
    descriptionEn: Description("English description").optional(),
    descriptionAr: Description("Arabic description").optional(),
    sortOrder: SortOrder.default(0),
  })
  .meta({ id: "CreateTripClass" });
export type CreateTripClass = z.output<typeof CreateTripClass>;

// Send only what changes.
export const UpdateTripClass = z
  .object({
    nameEn: ClassName("English name").optional(),
    nameAr: ClassName("Arabic name").optional(),
    descriptionEn: Description("English description").optional(),
    descriptionAr: Description("Arabic description").optional(),
    sortOrder: SortOrder.optional(),
  })
  .refine((update) => Object.keys(update).length > 0, {
    message: "Send at least one field to change.",
  })
  .meta({ id: "UpdateTripClass" });
export type UpdateTripClass = z.output<typeof UpdateTripClass>;
