import { z } from "zod";
import { Email, LinkToken, Name, Password, Phone } from "./fields";
import { Locale } from "./locale";
import { StaffPermission, StaffPermissions, staffPermissions } from "./permissions";

const InvitationToken = LinkToken("Invitation token");
const ResetToken = LinkToken("Reset token");

export const staffStatuses = ["ACTIVE", "SUSPENDED", "DELETED"] as const;
export const StaffStatus = z.enum(staffStatuses).meta({ id: "StaffStatus" });

export const Staff = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    status: StaffStatus,
    permissions: z.array(StaffPermission),
    locale: Locale,
  })
  .meta({ id: "Staff" });

export type Staff = z.infer<typeof Staff>;

// Their own name, phone and language. Only what's sent changes; a null phone removes it.
export const UpdateStaffAccount = z
  .object({
    firstName: Name("First name").optional(),
    lastName: Name("Last name").optional(),
    phone: Phone.nullable().optional(),
    locale: Locale.optional(),
  })
  .meta({ id: "UpdateStaffAccount" });

export type UpdateStaffAccount = z.output<typeof UpdateStaffAccount>;

// Team management: staff with the team permission, and admins, managing the company's staff.

// A deleted staff member's email is replaced by a placeholder, so the address can be invited again.
export const TeamMember = Staff.extend({
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
}).meta({ id: "TeamMember" });

export type TeamMember = z.infer<typeof TeamMember>;

export const ListTeam = z.object({
  q: z
    .string()
    .trim()
    .max(100, "Search must contain 100 characters at most.")
    .optional()
    .meta({ description: "Matches the name or the email." }),
  status: StaffStatus.optional().meta({
    description: "Only this status. Without it, everyone except deleted staff.",
  }),
});

export type ListTeam = z.output<typeof ListTeam>;

export const SetStaffPermissions = z
  .object({ permissions: StaffPermissions })
  .meta({ id: "SetStaffPermissions" });

export const StaffInvitation = z
  .object({
    id: z.string(),
    email: z.string(),
    permissions: z.array(StaffPermission),
    invitedBy: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .meta({ description: "The staff member who sent it. Null when an admin did." }),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().meta({
      description: "May be in the past: an expired invitation can still be resent or revoked.",
    }),
  })
  .meta({
    id: "StaffInvitation",
    description: "An invitation not accepted or revoked yet, expired or not.",
  });

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
