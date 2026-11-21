import type { GuestStart, Guest as GuestResponse } from "@terhal/contracts";
import type { GuestSession } from "../../../../generated/prisma/client";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { GUEST_SESSION_LIFETIME_MS } from "../domain/policy";
import { MAX_VERIFICATION_ATTEMPTS } from "../domain/verification-codes";
import { checkCode, deliverVerificationCode, newVerificationCode } from "./verification-codes";

// Guests book without an account. Their session is an opaque token in a cookie, only its hash stored, and it only
// counts once they've confirmed the code emailed to them (requireGuest checks that on every request).

const toGuestResponse = (session: GuestSession): GuestResponse => ({
  firstName: session.firstName,
  lastName: session.lastName,
  phone: session.phone,
  email: session.email,
  locale: session.locale,
  verified: session.verifiedAt !== null,
  expiresAt: session.expiresAt.toISOString(),
});

const noSession = () =>
  new AppError({
    code: "UNAUTHENTICATED",
    status: 401,
    detail: "Your guest session has ended. Please enter your details again.",
  });

// The live session behind a guest cookie, verified or not.
const findSession = async (token: string | undefined) => {
  if (!token) throw noSession();
  const session = await prisma.guestSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw noSession();
  return session;
};

// Starts a guest session and emails it a code. A session already in the browser is ended, so one browser holds one guest.
export const startGuest = async (input: GuestStart, previousToken: string | undefined) => {
  if (previousToken) await signOutGuest(previousToken);

  const token = generateToken();
  const now = new Date();
  const { code, columns } = newVerificationCode(now);

  const session = await prisma.guestSession.create({
    data: {
      ...input,
      tokenHash: hashToken(token),
      ...columns,
      expiresAt: new Date(now.getTime() + GUEST_SESSION_LIFETIME_MS),
    },
  });

  await deliverVerificationCode(input.email, code, input.locale);
  return { token, guest: toGuestResponse(session), expiresAt: session.expiresAt };
};

export const verifyGuest = async (token: string | undefined, code: string) => {
  const session = await findSession(token);
  if (session.verifiedAt) return toGuestResponse(session);

  const verificationHash = await checkCode(session, code, async (hash, now) => {
    const { count } = await prisma.guestSession.updateMany({
      where: {
        id: session.id,
        verifiedAt: null,
        verificationHash: hash,
        verificationAttempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        verificationExpiresAt: { gt: now },
      },
      data: { verificationAttempts: { increment: 1 } },
    });
    return count > 0;
  });

  // Matching on the code's hash makes sure it's used once, even by two requests at the same time.
  await prisma.guestSession.updateMany({
    where: { id: session.id, verifiedAt: null, verificationHash },
    data: {
      verifiedAt: new Date(),
      verificationHash: null,
      verificationExpiresAt: null,
      verificationAttempts: 0,
    },
  });

  return toGuestResponse(
    await prisma.guestSession.findUniqueOrThrow({ where: { id: session.id } }),
  );
};

// Emails a new code, replacing the old one. Nothing to do once the guest is verified.
export const resendGuestCode = async (token: string | undefined) => {
  const session = await findSession(token);
  if (session.verifiedAt) return;

  const { code, columns } = newVerificationCode();
  const { count } = await prisma.guestSession.updateMany({
    where: { id: session.id, verifiedAt: null },
    data: columns,
  });
  if (count > 0) await deliverVerificationCode(session.email, code, session.locale);
};

// The verified guest. requireGuest has already checked the session.
export const currentGuest = async (guestSessionId: string) =>
  toGuestResponse(await prisma.guestSession.findUniqueOrThrow({ where: { id: guestSessionId } }));

// Ends the session behind this cookie. Always succeeds, even when it's already gone.
export const signOutGuest = async (token: string | undefined) => {
  if (!token) return;
  await prisma.guestSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};
