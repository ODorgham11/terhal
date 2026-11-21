import { auditActions, type AcceptAdminInvitation } from "@terhal/contracts";
import { origins } from "../../../platform/config/env";
import { decrypt, encrypt } from "../../../platform/crypto/encryption";
import { hash } from "../../../platform/crypto/passwords";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { createTotpSecret, getTotpUri, verifyTotp } from "../../../platform/crypto/totp";
import { prisma } from "../../../platform/db/prisma";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { recordAudit } from "../../audit/index";
import { INVITATION_LIFETIME_MS } from "../domain/policy";
import { adminInvitationEmail } from "./admin-emails";
import { requireCurrentCode } from "./step-up";

const invalid = () =>
  new AppError({
    code: "INVITATION_INVALID",
    status: 400,
    detail: "This invitation link is invalid or has already been used.",
  });

// Invites the very first admin. Only works while there are no admins at all: after that, every admin is invited by
// another admin, so nobody gets in without an admin on record behind it. Running it again before the invitation is
// accepted (e.g. to fix a typo in the email) revokes the earlier links, so only the newest one works.
export const inviteFirstAdmin = async (email: string) => {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    if ((await tx.admin.count()) > 0) {
      throw new AppError({
        code: "ACCOUNT_ALREADY_EXISTS",
        status: 409,
        detail: "An admin already exists. Further admins must be invited by an admin.",
      });
    }

    // With no admins yet, every pending invitation came from an earlier seed.
    const pending = await tx.adminInvitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, email: true },
    });

    if (pending.length > 0) {
      await tx.adminInvitation.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { revokedAt: now },
      });

      for (const { id, email } of pending) {
        await recordAudit(
          {
            adminId: null,
            action: auditActions.INVITATION_REVOKED,
            entityType: "AdminInvitation",
            entityId: id,
            after: { email, reason: "replaced_by_seed" },
          },
          tx,
        );
      }
    }

    return tx.adminInvitation.create({
      data: { email, tokenHash: hashToken(token), invitorId: null, expiresAt },
    });
  });

  return deliverInvitation(invitation.id, email, token, expiresAt, {
    invitorId: null,
    ipAddress: null,
  });
};

// Emails the link and records it. Nobody received a link that failed to send, so it's revoked straight away and only a
// delivered invitation is recorded as sent.
const deliverInvitation = async (
  invitationId: string,
  email: string,
  token: string,
  expiresAt: Date,
  { invitorId, ipAddress }: { invitorId: string | null; ipAddress: string | null },
) => {
  const link = `${origins.admin}/invite?token=${token}`;

  try {
    const { subject, text } = adminInvitationEmail(link, expiresAt);
    await sendEmail(email, subject, text);
  } catch (error) {
    await prisma.adminInvitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });

    logger.error({ err: error }, "failed to send admin invitation");
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      detail: "We couldn't send the invitation email. Please try again.",
    });
  }

  await recordAudit({
    adminId: invitorId,
    action: auditActions.INVITATION_SENT,
    entityType: "AdminInvitation",
    entityId: invitationId,
    after: { email, expiresAt: expiresAt.toISOString() },
    ipAddress,
  });

  return { email, expiresAt };
};

// Not accepted, not revoked and not expired: the invitations whose links still work.
const pending = (now: Date) => ({ acceptedAt: null, revokedAt: null, expiresAt: { gt: now } });

// An admin inviting another, confirmed with their current authenticator code. Inviting an email again revokes its
// earlier pending invitations, so only the newest link works.
export const inviteAdmin = async (
  { email, code }: { email: string; code: string },
  invitorId: string,
  ipAddress: string | null,
) => {
  await requireCurrentCode(invitorId, code, "invite_admin", ipAddress);

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_LIFETIME_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    if (await tx.admin.findUnique({ where: { email }, select: { id: true } })) {
      throw new AppError({
        code: "ACCOUNT_ALREADY_EXISTS",
        status: 409,
        detail: "An admin account with this email already exists.",
      });
    }

    const replaced = await tx.adminInvitation.updateManyAndReturn({
      where: { email, ...pending(now) },
      data: { revokedAt: now },
      select: { id: true },
    });

    for (const { id } of replaced) {
      await recordAudit(
        {
          adminId: invitorId,
          action: auditActions.INVITATION_REVOKED,
          entityType: "AdminInvitation",
          entityId: id,
          after: { email, reason: "replaced" },
          ipAddress,
        },
        tx,
      );
    }

    return tx.adminInvitation.create({
      data: { email, tokenHash: hashToken(token), invitorId, expiresAt },
    });
  });

  const sent = await deliverInvitation(invitation.id, email, token, expiresAt, {
    invitorId,
    ipAddress,
  });
  return { email: sent.email, expiresAt: sent.expiresAt.toISOString() };
};

// The invitations still waiting to be accepted, newest first. There are only ever a few, so they come in one page.
export const listInvitations = async () => {
  const invitations = await prisma.adminInvitation.findMany({
    where: pending(new Date()),
    orderBy: { createdAt: "desc" },
    include: { invitor: { select: { id: true, firstName: true, lastName: true } } },
  });

  return {
    data: invitations.map(({ id, email, invitor, createdAt, expiresAt }) => ({
      id,
      email,
      invitedBy: invitor
        ? { id: invitor.id, name: `${invitor.firstName} ${invitor.lastName}` }
        : null,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })),
    nextCursor: null,
  };
};

// Takes back a pending invitation, so its link stops working. One that's unknown or no longer pending is a 404.
export const revokeInvitation = async (
  invitationId: string,
  adminId: string,
  ipAddress: string | null,
) => {
  await prisma.$transaction(async (tx) => {
    const [revoked] = await tx.adminInvitation.updateManyAndReturn({
      where: { id: invitationId, ...pending(new Date()) },
      data: { revokedAt: new Date() },
      select: { id: true, email: true },
    });

    if (!revoked) {
      throw new AppError({
        code: "NOT_FOUND",
        status: 404,
        detail: "There's no pending invitation with this id.",
      });
    }

    await recordAudit(
      {
        adminId,
        action: auditActions.INVITATION_REVOKED,
        entityType: "AdminInvitation",
        entityId: revoked.id,
        after: { email: revoked.email, reason: "revoked_by_admin" },
        ipAddress,
      },
      tx,
    );
  });
};

// Finds an invitation that can still be accepted, or explains why it can't.
const findUsableInvitation = async (token: string) => {
  const invitation = await prisma.adminInvitation.findUnique({
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
export const previewInvitation = async (token: string) => {
  const { email, expiresAt } = await findUsableInvitation(token);
  return { email, expiresAt: expiresAt.toISOString() };
};

// Gives the invitee a two-factor secret to add to their authenticator app. The same secret comes back if they ask again
// (e.g. after a refresh), so a code from an app they already set up keeps working. Only a new secret is recorded.
export const startTotpSetup = async (token: string, ipAddress: string | null) => {
  const invitation = await findUsableInvitation(token);

  if (invitation.totpSecret) {
    const secret = decrypt(invitation.totpSecret);
    return { uri: getTotpUri(secret, invitation.email), secret };
  }

  const secret = createTotpSecret();

  await prisma.$transaction(async (tx) => {
    // Only fills an empty slot, so two requests at once can't hand out two different secrets.
    const { count } = await tx.adminInvitation.updateMany({
      where: { id: invitation.id, totpSecret: null, acceptedAt: null, revokedAt: null },
      data: { totpSecret: encrypt(secret) },
    });

    if (count === 0) return;

    await recordAudit(
      {
        adminId: null,
        action: auditActions.INVITATION_TOTP_ISSUED,
        entityType: "AdminInvitation",
        entityId: invitation.id,
        ipAddress,
      },
      tx,
    );
  });

  // Whichever secret was stored is the one that counts, even if another request stored it first.
  const stored = await prisma.adminInvitation.findUniqueOrThrow({
    where: { id: invitation.id },
    select: { totpSecret: true },
  });
  if (!stored.totpSecret) throw invalid();

  const current = decrypt(stored.totpSecret);
  return { uri: getTotpUri(current, invitation.email), secret: current };
};

// Creates the admin account once they've proven their authenticator app works. The invitation is claimed in the same
// transaction that creates the account, so a link can't be used twice even by two requests at once.
export const acceptInvitation = async (
  { token, code, password, ...details }: AcceptAdminInvitation,
  ipAddress: string | null,
) => {
  const invitation = await findUsableInvitation(token);

  if (!invitation.totpSecret) {
    throw new AppError({
      code: "TOTP_SETUP_REQUIRED",
      status: 400,
      detail: "Set up two-factor authentication before creating your account.",
    });
  }

  const step = verifyTotp(decrypt(invitation.totpSecret), code, null);

  if (step === null) {
    await recordAudit({
      adminId: null,
      action: auditActions.INVITATION_ACCEPT_FAILED,
      entityType: "AdminInvitation",
      entityId: invitation.id,
      after: { reason: "wrong_code" },
      ipAddress,
    });
    throw new AppError({
      code: "TOTP_CODE_INVALID",
      status: 400,
      detail: "That code didn't work. Check your authenticator app and try again.",
    });
  }

  const existing = await prisma.admin.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  if (existing) {
    throw new AppError({
      code: "ACCOUNT_ALREADY_EXISTS",
      status: 409,
      detail: "An admin account with this email already exists.",
    });
  }

  const passwordHash = await hash(password);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Matching the secret too means a secret swapped in by another request can't be used with this code.
    const { count } = await tx.adminInvitation.updateMany({
      where: {
        id: invitation.id,
        totpSecret: invitation.totpSecret,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now, totpSecret: null },
    });

    if (count === 0) throw invalid();

    const created = await tx.admin.create({
      data: {
        ...details,
        email: invitation.email,
        passwordHash,
        totpSecret: invitation.totpSecret,
        totpEnabledAt: now,
        // The code used to confirm setup can't be reused to sign in.
        totpLastUsedStep: step,
        lastLoginAt: now,
      },
    });

    // Recorded in the same transaction, so an admin can't exist without a record of how they got in.
    await recordAudit(
      {
        adminId: created.id,
        action: auditActions.INVITATION_ACCEPTED,
        entityType: "AdminInvitation",
        entityId: invitation.id,
        after: { adminId: created.id, email: created.email, invitedBy: invitation.invitorId },
        ipAddress,
      },
      tx,
    );

    await recordAudit(
      {
        adminId: created.id,
        action: auditActions.TOTP_ENABLED,
        entityType: "Admin",
        entityId: created.id,
        ipAddress,
      },
      tx,
    );

    return created;
  });
};
