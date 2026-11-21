import { z } from "zod";
import { Email, LinkToken, Name, Password, Phone } from "./fields";
import { StaffPermission, StaffPermissions, staffPermissions } from "./permissions";

const InvitationToken = LinkToken("Invitation token");
const ResetToken = LinkToken("Reset token");

export const Staff = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]),
    permissions: z.array(StaffPermission),
  })
  .meta({ id: "Staff" });

export type Staff = z.infer<typeof Staff>;

// Only checks the password is there: rule changes must never lock out passwords set under the old rules.
export const StaffSignIn = z
  .object({
    email: Email,
    password: z.string({ error: "Password is required." }).min(1, "Password is required."),
  })
  .meta({ id: "StaffSignIn" });

export const StaffInvitationToken = z
  .object({ token: InvitationToken })
  .meta({ id: "StaffInvitationToken" });

export const StaffInvitationPreview = z
  .object({
    email: z.string(),
    permissions: z.array(StaffPermission),
    expiresAt: z.iso.datetime(),
  })
  .meta({ id: "StaffInvitationPreview", description: "What the invitee sees before accepting." });

// The email and the permissions come from the invitation.
export const AcceptStaffInvitation = z
  .object({
    token: InvitationToken,
    firstName: Name("First name"),
    lastName: Name("Last name"),
    phone: Phone.optional(),
    password: Password,
  })
  .meta({ id: "AcceptStaffInvitation" });

export type AcceptStaffInvitation = z.infer<typeof AcceptStaffInvitation>;

// A staff member with the team permission inviting a colleague.
export const InviteStaff = z
  .object({ email: Email, permissions: StaffPermissions })
  .meta({ id: "InviteStaff" });

export type InviteStaff = z.output<typeof InviteStaff>;

// An admin inviting a staff member, such as the company's first. Every permission unless told otherwise.
export const AdminInviteStaff = z
  .object({ email: Email, permissions: StaffPermissions.default([...staffPermissions]) })
  .meta({ id: "AdminInviteStaff" });

export const StaffInvitationSent = z
  .object({ email: z.string(), expiresAt: z.iso.datetime() })
  .meta({ id: "StaffInvitationSent" });

export const RequestStaffPasswordReset = z
  .object({ email: Email })
  .meta({ id: "RequestStaffPasswordReset" });

export const CompleteStaffPasswordReset = z
  .object({ token: ResetToken, password: Password })
  .meta({ id: "CompleteStaffPasswordReset" });
