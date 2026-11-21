import type { Locale } from "@terhal/contracts";
import { origins } from "../../../platform/config/env";
import { hash } from "../../../platform/crypto/passwords";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { logger } from "../../../platform/logger/logger";
import { CUSTOMER_PASSWORD_RESET_LIFETIME_MS } from "../domain/policy";
import { customerInactive } from "./customers";

const resetInvalid = () =>
  new AppError({
    code: "PASSWORD_RESET_INVALID",
    status: 400,
    detail: "This reset link is invalid or has already been used. Please ask for a new one.",
  });

// In the customer's language only: they chose it on the site.
const resetEmail = (link: string, locale: Locale) =>
  locale === "ar"
    ? {
        subject: "إعادة تعيين كلمة المرور في ترحال",
        text: [
          "طلبت إعادة تعيين كلمة المرور لحسابك في ترحال. اختر كلمة مرور جديدة من هنا:",
          link,
          "",
          "الرابط صالح لمدة ساعة واحدة ويمكن استخدامه مرة واحدة فقط. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.",
        ].join("\n"),
      }
    : {
        subject: "Reset your Terhal password",
        text: [
          "You asked to reset the password of your Terhal account. Choose a new one here:",
          link,
          "",
          "This link works once and expires in 1 hour. If you didn't ask for it, you can ignore this email and your password stays the same.",
        ].join("\n"),
      };

// Emails a reset link, replacing any earlier one so only the newest works. Does nothing for an email without an account
// (or a suspended or deleted one), and the caller answers the same either way, so this doesn't reveal which emails have
// accounts. For the same reason a failed email is only logged.
export const requestPasswordReset = async (email: string) => {
  const customer = await prisma.customer.findUnique({
    where: { email },
    select: { id: true, status: true, locale: true },
  });
  if (!customer || customer.status === "SUSPENDED" || customer.status === "DELETED") return;

  const token = generateToken();
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      passwordResetHash: hashToken(token),
      passwordResetExpiresAt: new Date(Date.now() + CUSTOMER_PASSWORD_RESET_LIFETIME_MS),
    },
  });

  const { subject, text } = resetEmail(
    `${origins.site}/reset-password?token=${token}`,
    customer.locale,
  );
  try {
    await sendEmail(email, subject, text);
  } catch (error) {
    logger.error({ err: error }, "failed to send a password reset link");
  }
};

// Sets the new password and signs the customer out everywhere, since the reset may be because someone else got in.
export const completePasswordReset = async (token: string, password: string) => {
  const tokenHash = hashToken(token);
  const customer = await prisma.customer.findUnique({
    where: { passwordResetHash: tokenHash },
    select: { id: true, status: true, passwordResetExpiresAt: true },
  });

  if (!customer) throw resetInvalid();
  if (!customer.passwordResetExpiresAt || customer.passwordResetExpiresAt <= new Date()) {
    throw new AppError({
      code: "PASSWORD_RESET_EXPIRED",
      status: 400,
      detail: "This reset link has expired. Please ask for a new one.",
    });
  }
  if (customer.status === "SUSPENDED" || customer.status === "DELETED") throw customerInactive();

  const passwordHash = await hash(password);

  await prisma.$transaction(async (tx) => {
    // Matching on the token's hash makes sure the link is used once, even by two requests at the same time.
    const { count } = await tx.customer.updateMany({
      where: { id: customer.id, passwordResetHash: tokenHash },
      data: { passwordHash, passwordResetHash: null, passwordResetExpiresAt: null },
    });
    if (count === 0) throw resetInvalid();

    await tx.customerSession.updateMany({
      where: { customerId: customer.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });
};
