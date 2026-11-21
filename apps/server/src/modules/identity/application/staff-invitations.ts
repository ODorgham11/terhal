import { auditActions, type AcceptStaffInvitation, type StaffPermission } from "@terhal/contracts";
import { origins } from "../../../platform/config/env";
import { hash } from "../../../platform/crypto/passwords";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { recordAudit } from "../../audit/index";
import { STAFF_INVITATION_LIFETIME_MS } from "../domain/policy";
import { permissionsOf } from "./staff";
import { staffInvitationEmail } from "./staff-emails";

const invalid = () =>
  new AppError({
    code: "INVITATION_INVALID",
    status: 400,
    detail: "This invitation link is invalid or has already been used.",
  });

const alreadyStaff = () =>
  new AppError({
    code: "ACCOUNT_ALREADY_EXISTS",
    status: 409,
    detail: "A staff account with this email already exists.",
  });

interface Invitation {
  email: string;
  permissions: StaffPermission[];
}

// Who sent it: a staff member with the team permission, or an admin (who has no Staff row, so invitorId stays empty).
type Invitor = { staffId: string } | { adminId: string; ipAddress: string | null };

// Creates the invitation and emails its link. Inviting an email again revokes its earlier pending invitations, so only
// the newest link works (e.g. after fixing the permissions). Nobody received a link that failed to send, so it's revoked
// straight away.
const invite = async ({ email, permissions }: Invitation, invitor: Invitor) => {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STAFF_INVITATION_LIFETIME_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    if (await tx.staff.findUnique({ where: { email }, select: { id: true } })) throw alreadyStaff();

    await tx.staffInvitation.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });

    return tx.staffInvitation.create({
      data: {
        email,
        tokenHash: hashToken(token),
        invitorId: "staffId" in invitor ? invitor.staffId : null,
        permissions,
        expiresAt,
      },
    });
  });

  const { subject, text } = staffInvitationEmail(
    `${origins.staff}/invite?token=${token}`,
    expiresAt,
  );

  try {
    await sendEmail(email, subject, text);
  } catch (error) {
    await prisma.staffInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });

    logger.error({ err: error }, "failed to send staff invitation");
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      detail: "We couldn't send the invitation email. Please try again.",
    });
  }

  if ("adminId" in invitor) {
    await recordAudit({
      adminId: invitor.adminId,
      action: auditActions.STAFF_INVITED,
      entityType: "StaffInvitation",
      entityId: invitation.id,
      after: { email, permissions, expiresAt: expiresAt.toISOString() },
      ipAddress: invitor.ipAddress,
    });
  }

  return { email, expiresAt: expiresAt.toISOString() };
};

// A staff member with the team permission inviting a colleague.
export const inviteStaff = (invitation: Invitation, staffId: string) =>
  invite(invitation, { staffId });

// An admin inviting a staff member: how the company's first staff member gets in.
export const inviteStaffAsAdmin = (
  invitation: Invitation,
  adminId: string,
  ipAddress: string | null,
) => invite(invitation, { adminId, ipAddress });

// Finds an invitation that can still be accepted, or explains why it can't.
const findUsableInvitation = async (token: string) => {
  const invitation = await prisma.staffInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) throw invalid();

  if (invitation.expiresAt <= new Date()) {
    throw new AppError({
      code: "INVITATION_EXPIRED",
      status: 400,
      detail: "This invitation has expired. Ask for a new one.",
    });
  }

  return invitation;
};

// What the invitee sees before accepting, without using up the invitation.
export const previewStaffInvitation = async (token: string) => {
  const { email, permissions, expiresAt } = await findUsableInvitation(token);
  return { email, permissions: permissionsOf(permissions), expiresAt: expiresAt.toISOString() };
};

// Creates the staff account with the invitation's permissions. The invitation is claimed in the same transaction that
// creates the account, so a link can't be used twice even by two requests at once.
export const acceptStaffInvitation = async ({
  token,
  password,
  ...details
}: AcceptStaffInvitation) => {
  const invitation = await findUsableInvitation(token);

  if (await prisma.staff.findUnique({ where: { email: invitation.email }, select: { id: true } })) {
    throw alreadyStaff();
  }

  const passwordHash = await hash(password);
  const now = new Date();

  try {
    return await prisma.$transaction(async (tx) => {
      const { count } = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now },
      });

      if (count === 0) throw invalid();

      return tx.staff.create({
        data: {
          ...details,
          email: invitation.email,
          passwordHash,
          permissions: permissionsOf(invitation.permissions),
          lastLoginAt: now,
        },
      });
    });
  } catch (error) {
    // Two invitations for the same email accepted at once: the second loses on the unique email.
    if (violatedUniqueIndex(error) === "Staff_email_key") throw alreadyStaff();
    throw error;
  }
};
