import { z } from "zod";

// Normalized the same way everywhere an admin email comes in, so it always matches how it was stored.
export const Email = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .max(75, "Email must contain 75 characters at most.")
  .pipe(z.email("Please enter a valid email address."))
  .meta({ example: "admin@terhal.co" });

const InvitationToken = z
  .string({ error: "Invitation token is required." })
  .min(1, "Invitation token is required.")
  .meta({ description: "From the invitation link." });

const Name = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(2, `${label} must contain at least 2 letters.`)
    .max(50, `${label} must contain 50 letters at most.`);

const Password = z
  .string({ error: "Password is required." })
  .min(8, "Password must contain at least 8 characters.")
  .max(72, "Password must contain 72 characters at most.")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
  .regex(/\d/, "Password must contain at least one number.");

const Code = z
  .string({ error: "Authentication code is required." })
  .trim()
  .regex(/^\d{6}$/, "Please enter the 6-digit code from your authenticator app.")
  .meta({ example: "482913" });

export const Admin = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
  })
  .meta({ id: "Admin" });

export type Admin = z.infer<typeof Admin>;

export const AdminInvitationToken = z
  .object({ token: InvitationToken })
  .meta({ id: "AdminInvitationToken" });

export const AdminInvitationPreview = z
  .object({ email: z.string(), expiresAt: z.iso.datetime() })
  .meta({ id: "AdminInvitationPreview", description: "What the invitee sees before accepting." });

export const TotpSetup = z
  .object({
    uri: z.string().meta({ description: "The otpauth:// link to show as a QR code." }),
    secret: z.string().meta({ description: "The same secret, for typing in by hand." }),
  })
  .meta({ id: "TotpSetup" });

// The email comes from the invitation. The code confirms their authenticator app works.
export const AcceptAdminInvitation = z
  .object({
    token: InvitationToken,
    firstName: Name("First name"),
    lastName: Name("Last name"),
    password: Password,
    code: Code,
  })
  .meta({ id: "AcceptAdminInvitation" });

export type AcceptAdminInvitation = z.infer<typeof AcceptAdminInvitation>;

// Only checks the password is there: rule changes must never lock out passwords set under the old rules.
export const AdminSignIn = z
  .object({
    email: Email,
    password: z.string({ error: "Password is required." }).min(1, "Password is required."),
  })
  .meta({ id: "AdminSignIn" });

export const AdminChallenge = z
  .object({ twoFactorRequired: z.literal(true) })
  .meta({ id: "AdminChallenge", description: "Password right; send a code to /auth/verify." });

export const AdminVerify = z.object({ code: Code }).meta({ id: "AdminVerify" });
