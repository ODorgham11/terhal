import { z } from "zod";
import { Email, LinkToken, Name, Password } from "./fields";

const InvitationToken = LinkToken("Invitation token");
const ResetToken = LinkToken("Reset token");

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

const StepUpCode = Code.meta({ description: "A current code from your authenticator app." });

// Actions that matter most ask for a current authenticator code again, so a stolen session alone can't do them.
export const AdminStepUp = z.object({ code: StepUpCode }).meta({ id: "AdminStepUp" });

// The id in a route's path, e.g. /admin/admins/{id}/deactivate.
export const IdParam = z.object({ id: z.string().min(1, "Id is required.") });

// Invitations

export const InviteAdmin = z.object({ email: Email, code: StepUpCode }).meta({ id: "InviteAdmin" });

export const AdminInvitationSent = z
  .object({ email: z.string(), expiresAt: z.iso.datetime() })
  .meta({ id: "AdminInvitationSent" });

export const AdminInvitation = z
  .object({
    id: z.string(),
    email: z.string(),
    invitedBy: z.object({ id: z.string(), name: z.string() }).nullable().meta({
      description: "Null for the first admin's invitation, sent before any admin existed.",
    }),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .meta({
    id: "AdminInvitation",
    description: "A pending invitation: not accepted, revoked or expired.",
  });

// Passwords

export const RequestAdminPasswordReset = z
  .object({ email: Email })
  .meta({ id: "RequestAdminPasswordReset" });

// The code proves the person resetting also has the account's authenticator, so the inbox alone can't take the account.
export const CompleteAdminPasswordReset = z
  .object({ token: ResetToken, password: Password, code: Code })
  .meta({ id: "CompleteAdminPasswordReset" });

// Only checks the current password is there: rule changes must never lock out passwords set under the old rules.
export const ChangeAdminPassword = z
  .object({
    currentPassword: z
      .string({ error: "Current password is required." })
      .min(1, "Current password is required."),
    newPassword: Password,
    code: StepUpCode,
  })
  .meta({ id: "ChangeAdminPassword" });

// Sessions

export const AdminSession = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    current: z.boolean().meta({ description: "The session making this request." }),
  })
  .meta({ id: "AdminSession" });

// Managing admins

export const AdminAccount = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
    twoFactorEnabled: z.boolean().meta({
      description:
        "False while a two-factor reset waits for the admin to set up a new authenticator.",
    }),
    lastLoginAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "AdminAccount" });

// Two-factor resets

export const TwoFactorResetToken = z
  .object({ token: ResetToken })
  .meta({ id: "TwoFactorResetToken" });

// The password too, so the emailed link alone isn't enough to take the account.
export const ConfirmTwoFactorReset = z
  .object({
    token: ResetToken,
    password: z.string({ error: "Password is required." }).min(1, "Password is required."),
    code: Code,
  })
  .meta({ id: "ConfirmTwoFactorReset" });
