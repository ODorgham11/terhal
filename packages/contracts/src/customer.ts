import { z } from "zod";
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
