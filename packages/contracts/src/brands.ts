import { z } from "zod";
import { Email, Phone } from "./fields";

// Brands: other companies of the client's that a trip can be sent under, e.g. Alex Limousine. The booker's emails come
// from the brand's address and carry its name and contacts, and so does the driver's WhatsApp message. Terhal itself is
// built in: a trip with no brand is Terhal's, and every booking on the site is.

const BrandName = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} must contain at least 2 letters.`)
    .max(50, `${label} must contain 50 letters at most.`);

// Empty text clears an optional field.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    schema.nullable(),
  );

const Website = z
  .string({ error: "Website must be text." })
  .trim()
  .max(100, "Website must contain 100 characters at most.")
  .regex(
    /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i,
    "Please enter a website, e.g. alexlimousine.com.",
  )
  .meta({ example: "alexlimousine.com" });

export const Brand = z
  .object({
    id: z.string(),
    nameEn: z.string(),
    nameAr: z.string(),
    senderEmail: z.string().meta({
      description:
        "Emails come from this address. Its domain must be verified with the email provider.",
    }),
    replyTo: z.string().nullable(),
    phone: z.string().nullable(),
    website: z.string().nullable(),
    isDefault: z.boolean().meta({ description: "Pre-selected when staff book a trip." }),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "Brand" });
export type Brand = z.infer<typeof Brand>;

// What a trip shows of its brand; null on a trip means Terhal.
export const TripBrand = z
  .object({ id: z.string(), nameEn: z.string(), nameAr: z.string() })
  .meta({ id: "TripBrand", description: "The brand the trip is sent under. Null is Terhal." });
export type TripBrand = z.infer<typeof TripBrand>;

export const ListBrands = z.object({
  archived: z
    .enum(["true", "false"], { error: "Archived must be true or false." })
    .transform((value) => value === "true")
    .default(false)
    .meta({ description: "true lists only archived brands." }),
});

const brandFields = {
  nameEn: BrandName("English name"),
  nameAr: BrandName("Arabic name"),
  senderEmail: Email.meta({ description: "On a domain verified with the email provider." }),
  replyTo: optional(Email).optional(),
  phone: optional(Phone).optional(),
  website: optional(Website).optional(),
  isDefault: z.boolean({ error: "Default must be true or false." }).optional().meta({
    description: "Make it the default for staff bookings; the previous default stops being one.",
  }),
};

export const CreateBrand = z.object(brandFields).meta({ id: "CreateBrand" });
export type CreateBrand = z.output<typeof CreateBrand>;

// Send only what changes.
export const UpdateBrand = z
  .object({
    ...brandFields,
    nameEn: brandFields.nameEn.optional(),
    nameAr: brandFields.nameAr.optional(),
    senderEmail: brandFields.senderEmail.optional(),
  })
  .refine((update) => Object.values(update).some((value: unknown) => value !== undefined), {
    message: "Send at least one field to change.",
  })
  .meta({ id: "UpdateBrand" });
export type UpdateBrand = z.output<typeof UpdateBrand>;
