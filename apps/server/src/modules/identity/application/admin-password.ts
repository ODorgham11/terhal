import { auditActions } from "@terhal/contracts";
import { origins } from "../../../platform/config/env";
import { compare, hash } from "../../../platform/crypto/passwords";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { recordAudit } from "../../audit/index";
import { ADMIN_PASSWORD_RESET_LIFETIME_MS } from "../domain/policy";
import { adminPasswordResetEmail } from "./admin-emails";
import { inactive } from "./admins";
import { revokeAdminSessions } from "./sessions";
import { recordStepUpFailure, requireCurrentCode } from "./step-up";

const invalid = () =>
  new AppError({
    code: "PASSWORD_RESET_INVALID",
    status: 400,
    detail: "This reset link is invalid or has already been used.",
  });

// Emails an active admin a link to choose a new password. Says nothing either way, so it can't be used to find out which
// emails belong to admins: the email is sent in the background (a failure is only logged), so how long the request takes
// doesn't depend on it. A new request replaces the previous link. Recorded whenever the email belongs to an admin, since
// requests nobody made can mean someone is after the account.
export const requestAdminPasswordReset = async (email: string, ipAddress: string | null) => {
  const admin = await prisma.admin.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  if (!admin) return;

  if (admin.status !== "ACTIVE") {
    await recordAudit({
      adminId: admin.id,
      action: auditActions.PASSWORD_RESET_REQUESTED,
      entityType: "Admin",
      entityId: admin.id,
      after: { linkSent: false, reason: "account_inactive" },
      ipAddress,
    });
    return;
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + ADMIN_PASSWORD_RESET_LIFETIME_MS);

  await prisma.$transaction(async (tx) => {
    await tx.admin.update({
      where: { id: admin.id },
      data: { passwordResetHash: hashToken(token), passwordResetExpiresAt: expiresAt },
    });

    await recordAudit(
      {
        adminId: admin.id,
        action: auditActions.PASSWORD_RESET_REQUESTED,
        entityType: "Admin",
        entityId: admin.id,
        after: { linkSent: true, expiresAt: expiresAt.toISOString() },
        ipAddress,
      },
      tx,
    );
  });

  const { subject, text } = adminPasswordResetEmail(
    `${origins.admin}/reset-password?token=${token}`,
  );

  sendEmail(email, subject, text).catch((error: unknown) => {
    logger.error({ err: error }, "failed to send admin password reset");
  });
};

// Sets the new password and uses the link up. It also takes a current code from the admin's authenticator, so reading
// their inbox isn't enough to take the account. Every session is ended, so whoever may have known the old password is
// signed out everywhere.
export const completeAdminPasswordReset = async (
  { token, password, code }: { token: string; password: string; code: string },
  ipAddress: string | null,
) => {
  const tokenHash = hashToken(token);
  const admin = await prisma.admin.findUnique({
    where: { passwordResetHash: tokenHash },
    select: { id: true, status: true, passwordResetExpiresAt: true },
  });

  if (!admin) throw invalid();

  if (!admin.passwordResetExpiresAt || admin.passwordResetExpiresAt <= new Date()) {
    throw new AppError({
      code: "PASSWORD_RESET_EXPIRED",
      status: 400,
      detail: "This reset link has expired. Ask for a new one.",
    });
  }

  if (admin.status !== "ACTIVE") throw inactive();

  // A 403 TOTP_SETUP_REQUIRED while their two-factor is being reset: they set up the new authenticator first.
  await requireCurrentCode(admin.id, code, "password_reset", ipAddress);

  const passwordHash = await hash(password);

  await prisma.$transaction(async (tx) => {
    // Matching the hash again means two requests can't both use the same link.
    const { count } = await tx.admin.updateMany({
      where: { id: admin.id, passwordResetHash: tokenHash, status: "ACTIVE" },
      data: { passwordHash, passwordResetHash: null, passwordResetExpiresAt: null },
    });

    if (count === 0) throw invalid();

    await revokeAdminSessions(tx, admin.id, {
      reason: "password_reset",
      actorId: admin.id,
      ipAddress,
    });

    await recordAudit(
      {
        adminId: admin.id,
        action: auditActions.PASSWORD_RESET,
        entityType: "Admin",
        entityId: admin.id,
        ipAddress,
      },
      tx,
    );
  });
};

// A signed in admin choosing a new password. Takes the current one and a current authenticator code, so a session left
// open isn't enough. Every other session is ended; the one making the request stays signed in.
export const changeAdminPassword = async (
  {
    currentPassword,
    newPassword,
    code,
  }: { currentPassword: string; newPassword: string; code: string },
  { adminId, sessionId }: { adminId: string; sessionId: string },
  ipAddress: string | null,
) => {
  const admin = await prisma.admin.findUniqueOrThrow({
    where: { id: adminId },
    select: { passwordHash: true },
  });

  if (!(await compare(currentPassword, admin.passwordHash))) {
    await recordStepUpFailure(adminId, "change_password", "wrong_password", ipAddress);
    throw new AppError({
      code: "INVALID_CREDENTIALS",
      status: 401,
      detail: "Your current password is incorrect.",
    });
  }

  await requireCurrentCode(adminId, code, "change_password", ipAddress);

  const passwordHash = await hash(newPassword);

  await prisma.$transaction(async (tx) => {
    // A reset link asked for earlier would undo this, so it stops working too.
    await tx.admin.update({
      where: { id: adminId },
      data: { passwordHash, passwordResetHash: null, passwordResetExpiresAt: null },
    });

    await revokeAdminSessions(tx, adminId, {
      reason: "password_changed",
      actorId: adminId,
      ipAddress,
      except: sessionId,
    });

    await recordAudit(
      {
        adminId,
        action: auditActions.PASSWORD_CHANGED,
        entityType: "Admin",
        entityId: adminId,
        ipAddress,
      },
      tx,
    );
  });
};
