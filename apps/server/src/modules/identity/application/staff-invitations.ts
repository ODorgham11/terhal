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
import type { TeamContext } from "./team";

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

const auditActor = ({ actor }: TeamContext) =>
  "staffId" in actor ? { adminId: null, staffId: actor.staffId } : { adminId: actor.adminId };

const notPending = () =>
  new AppError({
    code: "NOT_FOUND",
    status: 404,
    detail: "There's no invitation with this id waiting to be accepted.",
  });

const unsent = () =>
  new AppError({
    code: "SERVICE_UNAVAILABLE",
    status: 503,
    detail: "We couldn't send the invitation email. Please try again.",
  });

const sendInvitationEmail = (email: string, token: string, expiresAt: Date) => {
  const { subject, text } = staffInvitationEmail(
    `${origins.staff}/invite?token=${token}`,
    expiresAt,
  );
  return sendEmail(email, subject, text);
};

// Creates the invitation and emails its link. Inviting an email again revokes its earlier pending invitations, so only
// the newest link works (e.g. after fixing the permissions). Nobody received a link that failed to send, so it's revoked
// straight away.
// Who sent it: a staff member with the team permission, or an admin (who has no Staff row, so invitorId stays empty).
const invite = async ({ email, permissions }: Invitation, context: TeamContext) => {
  const { actor } = context;
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
        invitorId: "staffId" in actor ? actor.staffId : null,
        permissions,
        expiresAt,
      },
    });
  });

  try {
    await sendInvitationEmail(email, token, expiresAt);
  } catch (error) {
    await prisma.staffInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });

    logger.error({ err: error }, "failed to send staff invitation");
    throw unsent();
  }

  await recordAudit({
    ...auditActor(context),
    action: auditActions.STAFF_INVITED,
    entityType: "StaffInvitation",
    entityId: invitation.id,
    after: { email, permissions, expiresAt: expiresAt.toISOString() },
    ipAddress: context.ipAddress,
  });

  return { email, expiresAt: expiresAt.toISOString() };
};

// A staff member with the team permission inviting a colleague.
export const inviteStaff = (invitation: Invitation, staffId: string, ipAddress: string | null) =>
  invite(invitation, { actor: { staffId }, ipAddress });

// An admin inviting a staff member: how the company's first staff member gets in.
export const inviteStaffAsAdmin = (
  invitation: Invitation,
  adminId: string,
  ipAddress: string | null,
) => invite(invitation, { actor: { adminId }, ipAddress });

// Not accepted or revoked. Expired ones count: they can still be resent, or revoked to tidy the list.
const open = { acceptedAt: null, revokedAt: null } as const;

// The invitations nobody has accepted or revoked, newest first. There are only ever a few, so they come in one page.
export const listStaffInvitations = async () => {
  const invitations = await prisma.staffInvitation.findMany({
    where: open,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { invitor: { select: { id: true, firstName: true, lastName: true } } },
  });

  return {
    data: invitations.map(({ id, email, permissions, invitor, createdAt, expiresAt }) => ({
      id,
      email,
      permissions: permissionsOf(permissions),
      invitedBy: invitor
        ? { id: invitor.id, name: `${invitor.firstName} ${invitor.lastName}` }
        : null,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })),
    nextCursor: null,
  };
};

// Takes back an invitation, so its link stops working. One that's unknown, accepted or already revoked is a 404.
export const revokeStaffInvitation = async (invitationId: string, context: TeamContext) => {
  await prisma.$transaction(async (tx) => {
    const [revoked] = await tx.staffInvitation.updateManyAndReturn({
      where: { id: invitationId, ...open },
      data: { revokedAt: new Date() },
      select: { id: true, email: true },
    });
    if (!revoked) throw notPending();

    await recordAudit(
      {
        ...auditActor(context),
        action: auditActions.STAFF_INVITATION_REVOKED,
        entityType: "StaffInvitation",
        entityId: revoked.id,
        after: { email: revoked.email },
        ipAddress: context.ipAddress,
      },
      tx,
    );
  });
};

// Emails the invitation again with a new link, valid for another 7 days, e.g. when the first email got lost or expired.
// Only the token's hash is stored, so the old link can't be sent again: it stops working.
export const resendStaffInvitation = async (invitationId: string, context: TeamContext) => {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + STAFF_INVITATION_LIFETIME_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    const [renewed] = await tx.staffInvitation.updateManyAndReturn({
      where: { id: invitationId, ...open },
      data: { tokenHash: hashToken(token), expiresAt },
      select: { id: true, email: true },
    });
    if (!renewed) throw notPending();

    // They may have joined since, through another invitation.
    if (await tx.staff.findUnique({ where: { email: renewed.email }, select: { id: true } })) {
      throw alreadyStaff();
    }

    await recordAudit(
      {
        ...auditActor(context),
        action: auditActions.STAFF_INVITATION_RESENT,
        entityType: "StaffInvitation",
        entityId: renewed.id,
        after: { email: renewed.email, expiresAt: expiresAt.toISOString() },
        ipAddress: context.ipAddress,
      },
      tx,
    );
    return renewed;
  });

  // The new link was never received, but the invitation stays open: resending again sends another.
  try {
    await sendInvitationEmail(invitation.email, token, expiresAt);
  } catch (error) {
    logger.error({ err: error }, "failed to resend staff invitation");
    throw unsent();
  }

  return { email: invitation.email, expiresAt: expiresAt.toISOString() };
};

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
