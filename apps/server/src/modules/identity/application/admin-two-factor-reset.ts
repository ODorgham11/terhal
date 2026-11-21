import { auditActions } from "@terhal/contracts";
import { origins } from "../../../platform/config/env";
import { decrypt, encrypt } from "../../../platform/crypto/encryption";
import { compare } from "../../../platform/crypto/passwords";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { createTotpSecret, getTotpUri, verifyTotp } from "../../../platform/crypto/totp";
import { prisma } from "../../../platform/db/prisma";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { recordAudit } from "../../audit/index";
import { TWO_FACTOR_RESET_LIFETIME_MS } from "../domain/policy";
import { adminTwoFactorResetEmail } from "./admin-emails";
import { adminNotFound, cannotTargetSelf } from "./admin-management";
import { inactive } from "./admins";
import { revokeAdminSessions } from "./sessions";
import { codeInvalid, requireCurrentCode } from "./step-up";

// An admin who lost their phone can't sign in, so another admin resets their two-factor: the old authenticator stops
// working at once, every session ends, and they're emailed a link to set up a new one. Until they do, they can't sign in.

const invalid = () =>
  new AppError({
    code: "TWO_FACTOR_RESET_INVALID",
    status: 400,
    detail: "This link is invalid or has already been used.",
  });

const targetNotActive = () =>
  new AppError({
    code: "ADMIN_NOT_ACTIVE",
    status: 409,
    detail: "This admin isn't active. Reactivate them first.",
  });

export const resetTwoFactor = async (
  targetId: string,
  code: string,
  actorId: string,
  ipAddress: string | null,
) => {
  const target = await prisma.admin.findUnique({
    where: { id: targetId },
    select: { id: true, email: true, status: true },
  });
  if (!target) throw adminNotFound();
  if (targetId === actorId) {
    throw cannotTargetSelf(
      "You can't reset your own two-factor authentication. Ask another admin.",
    );
  }
  if (target.status !== "ACTIVE") throw targetNotActive();

  await requireCurrentCode(actorId, code, "reset_two_factor", ipAddress);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TWO_FACTOR_RESET_LIFETIME_MS);

  await prisma.$transaction(async (tx) => {
    // Resetting again (e.g. when the email went astray) replaces the earlier link.
    const { count } = await tx.admin.updateMany({
      where: { id: targetId, status: "ACTIVE" },
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        totpLastUsedStep: null,
        pendingTotpSecret: null,
        twoFactorResetHash: hashToken(token),
        twoFactorResetExpiresAt: expiresAt,
      },
    });
    if (count === 0) throw targetNotActive();

    await revokeAdminSessions(tx, targetId, { reason: "two_factor_reset", actorId, ipAddress });

    await recordAudit(
      {
        adminId: actorId,
        action: auditActions.TOTP_RESET,
        entityType: "Admin",
        entityId: targetId,
        after: { expiresAt: expiresAt.toISOString() },
        ipAddress,
      },
      tx,
    );
  });

  const { subject, text } = adminTwoFactorResetEmail(
    `${origins.admin}/two-factor/setup?token=${token}`,
    expiresAt,
  );

  // The reset itself stands (the old authenticator must stop working either way); resetting again sends a new link.
  try {
    await sendEmail(target.email, subject, text);
  } catch (error) {
    logger.error({ err: error }, "failed to send admin two-factor reset");
    throw new AppError({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
      detail:
        "Two-factor authentication was reset, but we couldn't send the email. Reset it again to send a new link.",
    });
  }
};

// Finds the admin a reset link still works for, or explains why it doesn't.
const findUsableReset = async (token: string) => {
  const tokenHash = hashToken(token);
  const admin = await prisma.admin.findUnique({ where: { twoFactorResetHash: tokenHash } });

  if (!admin) throw invalid();

  if (!admin.twoFactorResetExpiresAt || admin.twoFactorResetExpiresAt <= new Date()) {
    throw new AppError({
      code: "TWO_FACTOR_RESET_EXPIRED",
      status: 400,
      detail:
        "This link has expired. Ask another admin to reset your two-factor authentication again.",
    });
  }

  if (admin.status !== "ACTIVE") throw inactive();

  return { admin, tokenHash };
};

// Gives the admin a new two-factor secret to add to their authenticator app. The same secret comes back if they ask
// again (e.g. after a refresh), so a code from an app they already set up keeps working. It isn't accepted at sign in
// until they confirm it.
export const startTwoFactorSetup = async (token: string, ipAddress: string | null) => {
  const { admin, tokenHash } = await findUsableReset(token);

  if (admin.pendingTotpSecret) {
    const secret = decrypt(admin.pendingTotpSecret);
    return { uri: getTotpUri(secret, admin.email), secret };
  }

  const secret = createTotpSecret();

  await prisma.$transaction(async (tx) => {
    // Only fills an empty slot, so two requests at once can't hand out two different secrets.
    const { count } = await tx.admin.updateMany({
      where: { id: admin.id, twoFactorResetHash: tokenHash, pendingTotpSecret: null },
      data: { pendingTotpSecret: encrypt(secret) },
    });

    if (count === 0) return;

    await recordAudit(
      {
        adminId: admin.id,
        action: auditActions.TOTP_RESET_ISSUED,
        entityType: "Admin",
        entityId: admin.id,
        ipAddress,
      },
      tx,
    );
  });

  // Whichever secret was stored is the one that counts, even if another request stored it first.
  const stored = await prisma.admin.findUniqueOrThrow({
    where: { id: admin.id },
    select: { pendingTotpSecret: true },
  });
  if (!stored.pendingTotpSecret) throw invalid();

  const current = decrypt(stored.pendingTotpSecret);
  return { uri: getTotpUri(current, admin.email), secret: current };
};

// Makes the new authenticator the admin's once they've proven it works, and their password too, so the emailed link alone
// isn't enough to take the account. The caller signs them in.
export const confirmTwoFactorReset = async (
  { token, password, code }: { token: string; password: string; code: string },
  ipAddress: string | null,
) => {
  const { admin, tokenHash } = await findUsableReset(token);

  if (!admin.pendingTotpSecret) {
    throw new AppError({
      code: "TOTP_SETUP_REQUIRED",
      status: 400,
      detail: "Set up your authenticator app before confirming.",
    });
  }

  const fail = (reason: "wrong_password" | "wrong_code") =>
    recordAudit({
      adminId: admin.id,
      action: auditActions.TOTP_RESET_CONFIRM_FAILED,
      entityType: "Admin",
      entityId: admin.id,
      after: { reason },
      ipAddress,
    });

  if (!(await compare(password, admin.passwordHash))) {
    await fail("wrong_password");
    throw new AppError({
      code: "INVALID_CREDENTIALS",
      status: 401,
      detail: "The password is incorrect.",
    });
  }

  const step = verifyTotp(decrypt(admin.pendingTotpSecret), code, null);
  if (step === null) {
    await fail("wrong_code");
    throw codeInvalid();
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Matching the link and the secret means the link can't be used twice, and a secret swapped in by another request
    // can't be confirmed with this code.
    const [confirmed] = await tx.admin.updateManyAndReturn({
      where: {
        id: admin.id,
        status: "ACTIVE",
        twoFactorResetHash: tokenHash,
        pendingTotpSecret: admin.pendingTotpSecret,
      },
      data: {
        totpSecret: admin.pendingTotpSecret,
        totpEnabledAt: now,
        // The code used to confirm setup can't be reused to sign in.
        totpLastUsedStep: step,
        lastLoginAt: now,
        pendingTotpSecret: null,
        twoFactorResetHash: null,
        twoFactorResetExpiresAt: null,
      },
    });

    if (!confirmed) throw invalid();

    await recordAudit(
      {
        adminId: admin.id,
        action: auditActions.TOTP_ENABLED,
        entityType: "Admin",
        entityId: admin.id,
        after: { via: "two_factor_reset" },
        ipAddress,
      },
      tx,
    );

    return confirmed;
  });
};
