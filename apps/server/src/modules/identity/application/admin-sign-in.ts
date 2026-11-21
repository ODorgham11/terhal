import { auditActions } from "@terhal/contracts";
import { compare, compareAgainstNothing } from "../../../platform/crypto/passwords";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { inactive } from "./admins";
import { codeInvalid, consumeTotpCode, totpSetupRequired } from "./step-up";

const wrongCredentials = () =>
  new AppError({
    code: "INVALID_CREDENTIALS",
    status: 401,
    detail: "The email or password is incorrect.",
  });

const challengeExpired = () =>
  new AppError({
    code: "TOTP_CHALLENGE_INVALID",
    status: 401,
    detail: "Your sign in has expired. Please enter your email and password again.",
  });

// The first half of signing in: checks the password. The caller then asks for a two-factor code (see verifySignIn).
export const checkPassword = async (email: string, password: string, ipAddress: string | null) => {
  const admin = await prisma.admin.findUnique({ where: { email } });

  // Use the same error for both cases so the response doesn't reveal which accounts exist. Attempts on emails that
  // aren't admins are still recorded, since they can mean someone is guessing at accounts.
  if (!admin) {
    await compareAgainstNothing(password);
    await recordAudit({
      adminId: null,
      action: auditActions.SIGN_IN_PASSWORD_FAILED,
      entityType: "Email",
      entityId: email,
      ipAddress,
    });
    throw wrongCredentials();
  }

  if (!(await compare(password, admin.passwordHash))) {
    await recordAudit({
      adminId: admin.id,
      action: auditActions.SIGN_IN_PASSWORD_FAILED,
      entityType: "Admin",
      entityId: admin.id,
      ipAddress,
    });
    throw wrongCredentials();
  }

  // Checked after the password, so only someone who knows it learns the account is inactive.
  if (admin.status !== "ACTIVE") {
    await recordAudit({
      adminId: admin.id,
      action: auditActions.SIGN_IN_BLOCKED,
      entityType: "Admin",
      entityId: admin.id,
      after: { reason: "account_inactive" },
      ipAddress,
    });
    throw inactive();
  }

  if (!admin.totpSecret) throw totpSetupRequired();

  // A correct password with no code after it can mean the password leaked, so the half-finished sign in is recorded too.
  await recordAudit({
    adminId: admin.id,
    action: auditActions.SIGN_IN_PASSWORD_PASSED,
    entityType: "Admin",
    entityId: admin.id,
    ipAddress,
  });

  return admin;
};

// The second half of signing in: checks the two-factor code for the admin who passed the password check.
export const verifySignIn = async (
  adminId: string | null,
  code: string,
  ipAddress: string | null,
) => {
  if (!adminId) throw challengeExpired();

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });

  if (!admin?.totpSecret) throw challengeExpired();
  if (admin.status !== "ACTIVE") {
    await recordAudit({
      adminId: admin.id,
      action: auditActions.SIGN_IN_BLOCKED,
      entityType: "Admin",
      entityId: admin.id,
      after: { reason: "account_inactive" },
      ipAddress,
    });
    throw inactive();
  }

  const failure = await consumeTotpCode({ ...admin, totpSecret: admin.totpSecret }, code, {
    lastLoginAt: new Date(),
  });

  // A wrong code after a correct password is worth recording: it can mean someone has the password but not the phone.
  if (failure) {
    await recordAudit({
      adminId: admin.id,
      action: auditActions.SIGN_IN_TOTP_FAILED,
      entityType: "Admin",
      entityId: admin.id,
      after: { reason: failure },
      ipAddress,
    });
    throw codeInvalid();
  }

  return admin;
};
