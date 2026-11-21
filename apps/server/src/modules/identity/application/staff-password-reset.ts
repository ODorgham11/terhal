import { origins } from "../../../platform/config/env";
import { hash } from "../../../platform/crypto/passwords";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { STAFF_PASSWORD_RESET_LIFETIME_MS } from "../domain/policy";
import { staffPasswordResetEmail } from "./staff-emails";
import { revokeAllStaffSessions } from "./staff-sessions";

const invalid = () =>
  new AppError({
    code: "PASSWORD_RESET_INVALID",
    status: 400,
    detail: "This reset link is invalid or has already been used.",
  });

// Emails an active staff member a link to choose a new password. Says nothing either way, so it can't be used to find
// out which emails belong to staff: the email is sent in the background (a failure is only logged), so how long the
// request takes doesn't reveal it either. A new request replaces the previous link.
export const requestStaffPasswordReset = async (email: string) => {
  const token = generateToken();

  const { count } = await prisma.staff.updateMany({
    where: { email, status: "ACTIVE" },
    data: {
      passwordResetHash: hashToken(token),
      passwordResetExpiresAt: new Date(Date.now() + STAFF_PASSWORD_RESET_LIFETIME_MS),
    },
  });

  if (count === 0) return;

  const { subject, text } = staffPasswordResetEmail(
    `${origins.staff}/reset-password?token=${token}`,
  );

  sendEmail(email, subject, text).catch((error: unknown) => {
    logger.error({ err: error }, "failed to send staff password reset");
  });
};

// Sets the new password and uses the link up. Every session is revoked, so whoever may have known the old password is
// signed out everywhere.
export const completeStaffPasswordReset = async (token: string, password: string) => {
  const tokenHash = hashToken(token);
  const staff = await prisma.staff.findUnique({
    where: { passwordResetHash: tokenHash },
    select: { id: true, passwordResetExpiresAt: true },
  });

  if (!staff) throw invalid();

  if (!staff.passwordResetExpiresAt || staff.passwordResetExpiresAt <= new Date()) {
    throw new AppError({
      code: "PASSWORD_RESET_EXPIRED",
      status: 400,
      detail: "This reset link has expired. Ask for a new one.",
    });
  }

  const passwordHash = await hash(password);

  await prisma.$transaction(async (tx) => {
    // Matching the hash again means two requests can't both use the same link.
    const { count } = await tx.staff.updateMany({
      where: { id: staff.id, passwordResetHash: tokenHash },
      data: { passwordHash, passwordResetHash: null, passwordResetExpiresAt: null },
    });

    if (count === 0) throw invalid();

    await revokeAllStaffSessions(staff.id, tx);
  });
};
