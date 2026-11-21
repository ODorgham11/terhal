import { z } from "zod";

// Fields shared by every audience's schemas, so an email or a password is validated the same way everywhere.

// Normalized the same way everywhere an email comes in, so it always matches how it was stored.
export const Email = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .max(75, "Email must contain 75 characters at most.")
  .pipe(z.email("Please enter a valid email address."))
  .meta({ example: "someone@terhal.co" });

export const Name = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} must contain at least 2 letters.`)
    .max(50, `${label} must contain 50 letters at most.`);

export const Password = z
  .string({ error: "Password is required." })
  .min(8, "Password must contain at least 8 characters.")
  .max(72, "Password must contain 72 characters at most.")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
  .regex(/\d/, "Password must contain at least one number.");

// The single-use token in an emailed link (an invitation or a password reset).
export const LinkToken = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .min(1, `${label} is required.`)
    .meta({ description: "From the emailed link." });
