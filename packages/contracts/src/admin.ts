import { z } from "zod";
import { Email, LinkToken, Name, Password } from "./fields";

const InvitationToken = LinkToken("Invitation token");

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
