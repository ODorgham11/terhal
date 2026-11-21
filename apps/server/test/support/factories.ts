import { Secret, TOTP } from "otpauth";
import { encrypt } from "../../src/platform/crypto/encryption";
import { hash } from "../../src/platform/crypto/passwords";
import { generateToken, hashToken } from "../../src/platform/crypto/tokens";
import { createTotpSecret } from "../../src/platform/crypto/totp";
import { prisma } from "../../src/platform/db/prisma";

// The code an authenticator app would show for this secret, `stepsAhead` 30-second steps from now. The server accepts
// one step either side, so a code one step ahead is valid and newer than one just used.
export const totpCode = (secret: string, stepsAhead = 0) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({
    timestamp: Date.now() + stepsAhead * 30_000,
  });

export const createInvitation = async (email = "new.admin@terhal.co") => {
  const token = generateToken();
  const invitation = await prisma.adminInvitation.create({
    data: {
      email,
      tokenHash: hashToken(token),
      invitorId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { invitation, token };
};

export const ADMIN_PASSWORD = "Correct-horse-1";

// An active admin with two-factor set up, as if they'd accepted an invitation.
export const createAdmin = async (email = "admin@terhal.co") => {
  const secret = createTotpSecret();
  const admin = await prisma.admin.create({
    data: {
      email,
      firstName: "Test",
      lastName: "Admin",
      passwordHash: await hash(ADMIN_PASSWORD),
      totpSecret: encrypt(secret),
      totpEnabledAt: new Date(),
    },
  });
  return { admin, secret };
};
