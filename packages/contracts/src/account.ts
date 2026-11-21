import { z } from "zod";
import { Password } from "./fields";

// What staff and customers share when managing their own account. Admins have their own versions, which also ask for an
// authenticator code (admin.ts).

// Only checks the current password is there: rule changes must never lock out passwords set under the old rules.
export const CurrentPassword = z
  .string({ error: "Current password is required." })
  .min(1, "Current password is required.");

export const ChangePassword = z
  .object({ currentPassword: CurrentPassword, newPassword: Password })
  .meta({ id: "ChangePassword" });

export type ChangePassword = z.output<typeof ChangePassword>;

// One of the signed in account's own sessions (a device).
export const AccountSession = z
  .object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    current: z.boolean().meta({ description: "The session making this request." }),
  })
  .meta({ id: "AccountSession" });
