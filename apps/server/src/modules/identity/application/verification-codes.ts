import { randomInt } from "node:crypto";
import { sendEmail } from "../../../platform/email/email";
import { AppError } from "../../../platform/errors/app-error";
import { hashToken } from "../../../platform/crypto/tokens";
import { logger } from "../../../platform/logger/logger";
import {
  VERIFICATION_CODE_LIFETIME_MS,
  codeUsability,
  hashesMatch,
  verificationCodeExpiry,
  type VerificationCodeState,
} from "../domain/verification-codes";

// The codes customers and guests confirm their contact details with. Emailed for now; WhatsApp later.

export const wrongCode = () =>
  new AppError({
    code: "VERIFICATION_CODE_INVALID",
    status: 400,
    detail: "That code is incorrect. Check the code we sent you and try again.",
  });

const deadCode = () =>
  new AppError({
    code: "VERIFICATION_CODE_EXPIRED",
    status: 400,
    detail: "This code has expired or was tried too many times. Please ask for a new one.",
  });

// A fresh code and the columns that store it. Only the hash is stored, and a new code resets the tries.
export const newVerificationCode = (now = new Date()) => {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return {
    code,
    columns: {
      verificationHash: hashToken(code),
      verificationExpiresAt: verificationCodeExpiry(now),
      verificationAttempts: 0,
    },
  };
};

// Checks a code against the stored one. `reserveAttempt` must count the try atomically, only while the same code is
// stored with tries left and unexpired, and say whether it did. Counting before comparing means parallel guesses can
// never get more than the allowed tries between them. Throws unless the code is right.
export const checkCode = async (
  state: VerificationCodeState,
  code: string,
  reserveAttempt: (verificationHash: string, now: Date) => Promise<boolean>,
) => {
  const now = new Date();
  const usability = codeUsability(state, now);

  // No code at all (already verified, or never sent) reads as a wrong code, so it doesn't reveal anything.
  if (usability === "none" || !state.verificationHash) throw wrongCode();
  if (usability !== "usable") throw deadCode();
  if (!(await reserveAttempt(state.verificationHash, now))) throw deadCode();
  if (!hashesMatch(state.verificationHash, hashToken(code))) throw wrongCode();

  return state.verificationHash;
};

const minutes = VERIFICATION_CODE_LIFETIME_MS / 60_000;

const verificationEmail = (code: string) =>
  [
    `رمز التحقق الخاص بك في ترحال هو: ${code}`,
    "",
    `الرمز صالح لمدة ${minutes} دقائق. إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.`,
    "",
    "---",
    "",
    `Your Terhal verification code is: ${code}`,
    "",
    `It expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.`,
  ].join("\n");

// Never throws: the caller has already saved the code, and the person can always ask for a new one. Failing the request
// instead would, for a resend, reveal that the email belongs to someone.
export const deliverVerificationCode = async (email: string, code: string) => {
  try {
    await sendEmail(
      email,
      "رمز التحقق من ترحال | Your Terhal verification code",
      verificationEmail(code),
    );
  } catch (error) {
    logger.error({ err: error }, "failed to send a verification code");
  }
};
