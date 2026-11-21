import { z } from "zod";
import { CurrentPassword } from "./account";
import { CarBody } from "./cars";
import { Email, LinkToken, Name, Password, Phone } from "./fields";
import { DEFAULT_LOCALE, Locale } from "./locale";

// Customers (accounts on the customer site) and guests (booking without one). Both confirm their contact details with a
// 6-digit code that's emailed to them for now.

// The language their emails are sent in. The API can't read the site's locale cookie (it's on another host), so the site
// sends the visitor's language with sign up and guest start.
const AccountLocale = Locale.default(DEFAULT_LOCALE).meta({
  description: "The language emails are sent in: the site's current language. Arabic by default.",
});

const VerificationCode = z
  .string({ error: "Verification code is required." })
  .trim()
  .regex(/^\d{6}$/, "Please enter the 6-digit code we sent you.")
  .meta({ example: "482913" });

export const CustomerStatus = z.enum(["UNVERIFIED", "ACTIVE", "SUSPENDED", "DELETED"]);

export const Customer = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    email: z.string(),
    status: CustomerStatus,
    locale: Locale,
  })
  .meta({ id: "Customer" });

export type Customer = z.infer<typeof Customer>;

export const CustomerSignUp = z
  .object({
    firstName: Name("First name"),
    lastName: Name("Last name"),
    phone: Phone,
    email: Email,
    password: Password,
    locale: AccountLocale,
  })
  .meta({ id: "CustomerSignUp" });

export type CustomerSignUp = z.output<typeof CustomerSignUp>;

export const CustomerVerify = z
  .object({ email: Email, code: VerificationCode })
  .meta({ id: "CustomerVerify" });

export const CustomerEmail = z.object({ email: Email }).meta({ id: "CustomerEmail" });

// An email or a phone number, normalized the same way as when it was stored, so "01001234567" finds "+201001234567".
export const CustomerIdentifier = z
  .string({ error: "Email or phone number is required." })
  .trim()
  .min(1, "Email or phone number is required.")
  .transform((value, ctx) => {
    const result = (value.includes("@") ? Email : Phone).safeParse(value);
    if (result.success) return result.data;
    for (const issue of result.error.issues)
      ctx.addIssue({ code: "custom", message: issue.message });
    return z.NEVER;
  })
  .meta({ description: "The customer's email or phone number.", example: "01001234567" });

// Only checks the password is there: rule changes must never lock out passwords set under the old rules.
export const CustomerSignIn = z
  .object({
    identifier: CustomerIdentifier,
    password: z.string({ error: "Password is required." }).min(1, "Password is required."),
  })
  .meta({ id: "CustomerSignIn" });

export const CustomerPasswordReset = z
  .object({ token: LinkToken("Reset token"), password: Password })
  .meta({ id: "CustomerPasswordReset" });

export const GuestStart = z
  .object({
    firstName: Name("First name"),
    lastName: Name("Last name"),
    phone: Phone,
    email: Email,
    locale: AccountLocale,
  })
  .meta({ id: "GuestStart" });

export type GuestStart = z.output<typeof GuestStart>;

export const Guest = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    email: z.string(),
    locale: Locale,
    verified: z.boolean(),
    expiresAt: z.iso.datetime().meta({ description: "When the guest session ends." }),
  })
  .meta({ id: "Guest" });

export type Guest = z.infer<typeof Guest>;

export const GuestVerify = z.object({ code: VerificationCode }).meta({ id: "GuestVerify" });

// A signed in customer's own account. Staff and admins can't edit these details: customers own them.

// Their name and language. Only what's sent changes.
export const UpdateCustomerAccount = z
  .object({
    firstName: Name("First name").optional(),
    lastName: Name("Last name").optional(),
    locale: Locale.optional(),
  })
  .meta({ id: "UpdateCustomerAccount" });

export type UpdateCustomerAccount = z.output<typeof UpdateCustomerAccount>;

// A new email or phone takes the current password, so an open session alone can't take the account, and only replaces
// the current one once the emailed code is confirmed.
export const ChangeCustomerEmail = z
  .object({ email: Email, password: CurrentPassword })
  .meta({ id: "ChangeCustomerEmail" });

export const ChangeCustomerPhone = z
  .object({ phone: Phone, password: CurrentPassword })
  .meta({ id: "ChangeCustomerPhone" });

export const ConfirmContactChange = z
  .object({ code: VerificationCode })
  .meta({ id: "ConfirmContactChange" });

// Customers as staff and admins see them. Staff only view (the `customers` permission, or `trips` for the list);
// suspending and reactivating are admin-panel only. Guests aren't customers and never appear here.

const tripStatuses = [
  "PENDING",
  "CANCELLED",
  "CONFIRMED",
  "IN_PROGRESS",
  "AWAITING_REPORT",
  "COMPLETED",
] as const;

const Limit = z.coerce
  .number({ error: "Limit must be a number." })
  .int("Limit must be a whole number.")
  .min(1, "Limit must be at least 1.")
  .max(100, "Limit must be 100 at most.")
  .default(50);

const Cursor = z
  .string()
  .trim()
  .min(1, "Cursor is required.")
  .max(100, "Cursor must contain 100 characters at most.")
  .meta({ description: "The previous page's nextCursor." });

export const ListCustomers = z.object({
  q: z.string().trim().max(100, "Search must contain 100 characters at most.").optional().meta({
    description:
      "Matches the name, phone or email, ignoring case and Arabic spelling variants (أ/ا, ة/ه, ى/ي, diacritics).",
  }),
  status: CustomerStatus.optional(),
  cursor: Cursor.optional(),
  limit: Limit,
});

export type ListCustomers = z.output<typeof ListCustomers>;

export const CustomerSummary = Customer.extend({
  verifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
}).meta({ id: "CustomerSummary" });

export const CustomerDetail = CustomerSummary.extend({
  tripCount: z.int().meta({ description: "Every trip they booked, in any status." }),
  totalSpent: z.string().meta({
    description: "The total price of their completed trips, in EGP with two decimals.",
    example: "1250.00",
  }),
}).meta({ id: "CustomerDetail" });

export type CustomerDetail = z.infer<typeof CustomerDetail>;

export const ListCustomerTrips = z.object({
  status: z.enum(tripStatuses, { error: "Unknown status." }).optional(),
  cursor: Cursor.optional(),
  limit: Limit,
});

export type ListCustomerTrips = z.output<typeof ListCustomerTrips>;

export const CustomerTrip = z
  .object({
    id: z.string(),
    code: z.string(),
    status: z.enum(tripStatuses),
    source: z.enum(["CUSTOMER", "STAFF"]),
    pickupDate: z.iso.datetime(),
    pickup: z.string().meta({ description: "The pickup's name when it was booked." }),
    dropoff: z.string().meta({ description: "The drop-off's name when it was booked." }),
    car: CarBody,
    passengers: z.int(),
    totalPrice: z.string().nullable().meta({
      description: "EGP with two decimals. Null while a price is requested.",
      example: "1250.00",
    }),
    priceState: z.enum(["QUOTED", "REQUESTED", "PROPOSED", "ACCEPTED"]),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "CustomerTrip", description: "A trip the customer booked, newest pickup first." });

// Suspending or reactivating a customer is recorded with why.
export const CustomerStatusChange = z
  .object({
    reason: z
      .string({ error: "Reason is required." })
      .trim()
      .min(3, "Reason must contain at least 3 characters.")
      .max(500, "Reason must contain 500 characters at most."),
  })
  .meta({ id: "CustomerStatusChange" });

export const ContactChangeSent = z
  .object({
    sentTo: z.string().meta({
      description:
        "Where the code went: the new email for an email change, the current one for a phone change.",
    }),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: "ContactChangeSent" });
