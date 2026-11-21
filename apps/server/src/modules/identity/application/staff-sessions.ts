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
const issueTokens = async (staffId: string, sessionId: string) => {
  const refreshToken = generateToken();
  return {
    accessToken: await signAccessToken("staff", staffId, sessionId),
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
  };
};

// Starts a session for a staff member who has signed in (or just accepted an invitation), keeping at most a few active
// at once: the oldest are revoked to make way.
export const createStaffSession = async (staff: Staff, { ipAddress, userAgent }: RequestInfo) => {
  const refreshToken = generateToken();
  const refreshTokenHash = hashToken(refreshToken);
  const now = new Date();
  const expiresAt = staffSessionExpiry(now, now);

  const sessionId = await prisma.$transaction(async (tx) => {
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

    const session = await tx.staffSession.create({
      data: { staffId: staff.id, refreshToken: refreshTokenHash, expiresAt, ipAddress, userAgent },
    });

    return session.id;
  });

  const accessToken = await signAccessToken("staff", staff.id, sessionId);
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

  const tokens = await issueTokens(session.staff.id, session.id);
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

// Ends every session a staff member has (or every one but `except`), e.g. after their password changes. Pass the
// transaction client when it's part of a change, so the change and the sign out happen together.
export const revokeAllStaffSessions = async (
  staffId: string,
  client: typeof prisma | Prisma.TransactionClient = prisma,
  except?: string,
) => {
  await client.staffSession.updateMany({
    where: { staffId, revokedAt: null, ...(except ? { id: { not: except } } : {}) },
    data: { revokedAt: new Date() },
  });
};

// The signed in staff member's live sessions, newest first, marking the one making this request.
export const listStaffSessions = async (staffId: string, currentSessionId: string) => {
  const sessions = await prisma.staffSession.findMany({
    where: { staffId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
  });

  return {
    data: sessions.map((session) => ({
      ...session,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId,
    })),
    nextCursor: null,
  };
};

// Ends one of the signed in staff member's own sessions, e.g. a device they've lost. Someone else's session, or one
// that's already over, is a 404, so session ids can't be probed.
export const revokeOwnStaffSession = async (staffId: string, sessionId: string) => {
  const { count } = await prisma.staffSession.updateMany({
    where: { id: sessionId, staffId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    throw new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no such session." });
  }
};
