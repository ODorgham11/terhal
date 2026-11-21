import { auditActions } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { decrypt } from "../../../platform/crypto/encryption";
import { verifyTotp } from "../../../platform/crypto/totp";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";

export type CodeFailure = "wrong_code" | "code_reused";

export const codeInvalid = () =>
  new AppError({
    code: "TOTP_CODE_INVALID",
    status: 400,
    detail: "That code didn't work. Check your authenticator app and try again.",
  });

export const totpSetupRequired = () =>
  new AppError({
    code: "TOTP_SETUP_REQUIRED",
    status: 403,
    detail: "Two-factor authentication isn't set up for this account.",
  });

// Checks a code from the admin's authenticator and uses it up. The step is recorded in the same statement that checks
// it's newer than the last one used, so two requests can't both use one code; matching the secret too means a code for
// an authenticator that was reset meanwhile doesn't count. `data` is saved in that statement as well (e.g. lastLoginAt).
// Returns why the code failed, or null when it worked.
export const consumeTotpCode = async (
  admin: { id: string; totpSecret: string; totpLastUsedStep: number | null },
  code: string,
  data: Prisma.AdminUpdateManyMutationInput = {},
): Promise<CodeFailure | null> => {
  const secret = decrypt(admin.totpSecret);
  const step = verifyTotp(secret, code, admin.totpLastUsedStep);

  // Checked again without the last used step, to tell a wrong code apart from a correct one being reused.
  if (step === null) return verifyTotp(secret, code, null) === null ? "wrong_code" : "code_reused";

  const { count } = await prisma.admin.updateMany({
    where: {
      id: admin.id,
      totpSecret: admin.totpSecret,
      OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
    },
    data: { ...data, totpLastUsedStep: step },
  });

  return count === 0 ? "code_reused" : null;
};

// What an admin was doing when they were asked to prove themselves again, recorded with every failure.
export type StepUpPurpose =
  "invite_admin" | "change_password" | "password_reset" | "deactivate_admin" | "reset_two_factor";

// A failed step up is worth recording: it can mean someone has a session (or a reset link) but not the phone.
export const recordStepUpFailure = (
  adminId: string,
  purpose: StepUpPurpose,
  reason: CodeFailure | "wrong_password",
  ipAddress: string | null,
) =>
  recordAudit({
    adminId,
    action: auditActions.STEP_UP_FAILED,
    entityType: "Admin",
    entityId: adminId,
    after: { purpose, reason },
    ipAddress,
  });

// Asks for the admin's current authenticator code again before an action that matters, so a stolen session (or, for a
// password reset, a read inbox) isn't enough on its own. A wrong or reused code is a 400 TOTP_CODE_INVALID.
export const requireCurrentCode = async (
  adminId: string,
  code: string,
  purpose: StepUpPurpose,
  ipAddress: string | null,
) => {
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, totpSecret: true, totpLastUsedStep: true },
  });

  // Mid way through a two-factor reset, there's no authenticator to ask.
  if (!admin?.totpSecret) throw totpSetupRequired();

  const failure = await consumeTotpCode({ ...admin, totpSecret: admin.totpSecret }, code);
  if (failure) {
    await recordStepUpFailure(adminId, purpose, failure, ipAddress);
    throw codeInvalid();
  }
};
