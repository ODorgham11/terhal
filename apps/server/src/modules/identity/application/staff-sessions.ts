import type { Prisma, Staff } from "../../../../generated/prisma/client";
import { signAccessToken } from "../../../platform/crypto/jwt";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import {
  STAFF_SESSION_ABSOLUTE_LIFETIME_MS,
  staffSessionExpiry,
  staffSessionsToRevoke,
} from "../domain/policy";
import type { RequestInfo } from "./sessions";
import { staffInactive, toStaffResponse } from "./staff";

const sessionEnded = () =>
  new AppError({
    code: "INVALID_REFRESH_TOKEN",
    status: 401,
    detail: "Your session is invalid or has expired. Please sign in again.",
  });

// Refresh tokens are opaque random strings; the session row is what makes them valid. Only the hash is stored, so a
// leaked database can't be used to hijack sessions.
const issueTokens = async (staffId: string) => {
  const refreshToken = generateToken();
  return {
    accessToken: await signAccessToken("staff", staffId),
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
  };
};

// Starts a session for a staff member who has signed in (or just accepted an invitation), keeping at most a few active
// at once: the oldest are revoked to make way.
export const createStaffSession = async (staff: Staff, { ipAddress, userAgent }: RequestInfo) => {
  const { accessToken, refreshToken, refreshTokenHash } = await issueTokens(staff.id);
  const now = new Date();
  const expiresAt = staffSessionExpiry(now, now);

  await prisma.$transaction(async (tx) => {
    const activeSessions = await tx.staffSession.findMany({
      where: { staffId: staff.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const revoked = staffSessionsToRevoke(activeSessions);

    if (revoked.length > 0) {
      await tx.staffSession.updateMany({
        where: { id: { in: revoked.map((session) => session.id) } },
        data: { revokedAt: now },
      });
    }

    await tx.staffSession.create({
      data: { staffId: staff.id, refreshToken: refreshTokenHash, expiresAt, ipAddress, userAgent },
    });
  });

  return { staff: toStaffResponse(staff), session: { accessToken, refreshToken, expiresAt } };
};

export const refreshStaffSession = async (
  refreshToken: string | undefined,
  { ipAddress, userAgent }: RequestInfo,
) => {
  if (!refreshToken) throw sessionEnded();

  // Sessions only store the hash of the refresh token, so look it up the same way.
  const currentHash = hashToken(refreshToken);
  const session = await prisma.staffSession.findUnique({
    where: { refreshToken: currentHash },
    include: { staff: { select: { id: true, status: true } } },
  });

  if (!session) throw sessionEnded();

  const now = new Date();
  const absoluteExpiresAt = new Date(
    session.createdAt.getTime() + STAFF_SESSION_ABSOLUTE_LIFETIME_MS,
  );

  if (session.revokedAt || session.expiresAt <= now || absoluteExpiresAt <= now)
    throw sessionEnded();

  // Check the staff member again, since they may have been suspended since signing in.
  if (session.staff.status !== "ACTIVE") {
    await prisma.staffSession.update({ where: { id: session.id }, data: { revokedAt: now } });
    throw staffInactive();
  }

  const tokens = await issueTokens(session.staff.id);
  // Never extended past the session's absolute lifetime.
  const expiresAt = staffSessionExpiry(now, session.createdAt);

  // Rotate the refresh token in place. Matching on the old hash makes sure two requests can't both use it.
  const { count } = await prisma.staffSession.updateMany({
    where: { id: session.id, refreshToken: currentHash, revokedAt: null },
    data: { refreshToken: tokens.refreshTokenHash, expiresAt, ipAddress, userAgent },
  });

  if (count === 0) throw sessionEnded();

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt };
};

// Revokes the session behind this refresh token. Signing out always succeeds, even when the session is already gone.
export const signOutStaff = async (refreshToken: string | undefined) => {
  if (!refreshToken) return;

  await prisma.staffSession.updateMany({
    where: { refreshToken: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

// Ends every session a staff member has, e.g. after their password changes. Pass the transaction client when it's part
// of a change, so the change and the sign out happen together.
export const revokeAllStaffSessions = async (
  staffId: string,
  client: typeof prisma | Prisma.TransactionClient = prisma,
) => {
  await client.staffSession.updateMany({
    where: { staffId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};
