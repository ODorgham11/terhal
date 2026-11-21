import { auditActions } from "@terhal/contracts";
import type { Admin } from "../../../../generated/prisma/client";
import { signAccessToken } from "../../../platform/crypto/jwt";
import { generateToken, hashToken } from "../../../platform/crypto/tokens";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { SESSION_ABSOLUTE_LIFETIME_MS, sessionExpiry, sessionsToRevoke } from "../domain/policy";
import { inactive, toAdminResponse } from "./admins";

export interface RequestInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

const sessionEnded = () =>
  new AppError({
    code: "INVALID_REFRESH_TOKEN",
    status: 401,
    detail: "Your session is invalid or has expired. Please sign in again.",
  });

// Refresh tokens are opaque random strings; the session row is what makes them valid. Only the hash is stored, so a
// leaked database can't be used to hijack sessions.
const issueTokens = async (adminId: string) => {
  const refreshToken = generateToken();
  return {
    accessToken: await signAccessToken("admin", adminId),
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
  };
};

// Starts a session for an admin who has fully signed in, keeping at most a few active at once. `via` records how they
// got here: a new account from an invitation, or password plus two-factor code.
export const createSession = async (
  admin: Admin,
  via: "invitation" | "password_and_totp",
  { ipAddress, userAgent }: RequestInfo,
) => {
  const { accessToken, refreshToken, refreshTokenHash } = await issueTokens(admin.id);
  const now = new Date();
  const expiresAt = sessionExpiry(now, now);

  await prisma.$transaction(async (tx) => {
    const activeSessions = await tx.adminSession.findMany({
      where: { adminId: admin.id, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    // Revoke the oldest sessions to make way for the new one.
    const revoked = sessionsToRevoke(activeSessions);

    if (revoked.length > 0) {
      await tx.adminSession.updateMany({
        where: { id: { in: revoked.map((session) => session.id) } },
        data: { revokedAt: now },
      });

      for (const { id } of revoked) {
        await recordAudit(
          {
            adminId: admin.id,
            action: auditActions.SESSION_REVOKED,
            entityType: "AdminSession",
            entityId: id,
            after: { reason: "session_limit" },
            ipAddress,
          },
          tx,
        );
      }
    }

    const session = await tx.adminSession.create({
      data: { adminId: admin.id, refreshToken: refreshTokenHash, expiresAt, ipAddress, userAgent },
    });

    await recordAudit(
      {
        adminId: admin.id,
        action: auditActions.SIGN_IN_SUCCEEDED,
        entityType: "AdminSession",
        entityId: session.id,
        after: { via, userAgent, expiresAt: expiresAt.toISOString() },
        ipAddress,
      },
      tx,
    );
  });

  return { admin: toAdminResponse(admin), session: { accessToken, refreshToken, expiresAt } };
};

export const refreshSession = async (
  refreshToken: string | undefined,
  { ipAddress, userAgent }: RequestInfo,
) => {
  if (!refreshToken) throw sessionEnded();

  // Sessions only store the hash of the refresh token, so look it up the same way.
  const currentHash = hashToken(refreshToken);
  const session = await prisma.adminSession.findUnique({
    where: { refreshToken: currentHash },
    include: { admin: true },
  });

  if (!session) throw sessionEnded();

  const now = new Date();
  const absoluteExpiresAt = new Date(session.createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);

  if (session.revokedAt || session.expiresAt <= now || absoluteExpiresAt <= now)
    throw sessionEnded();

  // Check the admin again, since they may have been deactivated since signing in.
  if (session.admin.status !== "ACTIVE") {
    await prisma.$transaction(async (tx) => {
      await tx.adminSession.update({ where: { id: session.id }, data: { revokedAt: now } });
      await recordAudit(
        {
          adminId: session.admin.id,
          action: auditActions.SESSION_REVOKED,
          entityType: "AdminSession",
          entityId: session.id,
          after: { reason: "account_inactive" },
          ipAddress,
        },
        tx,
      );
    });

    throw inactive();
  }

  const tokens = await issueTokens(session.admin.id);
  // Never extended past the session's absolute lifetime.
  const expiresAt = sessionExpiry(now, session.createdAt);

  // Rotate the refresh token in place. Matching on the old hash makes sure two requests can't both use it.
  const { count } = await prisma.adminSession.updateMany({
    where: { id: session.id, refreshToken: currentHash, revokedAt: null },
    data: { refreshToken: tokens.refreshTokenHash, expiresAt, ipAddress, userAgent },
  });

  if (count === 0) throw sessionEnded();

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt };
};

// Revokes the session behind this refresh token. Signing out always succeeds, even when the session is already gone.
export const signOut = async (refreshToken: string | undefined, ipAddress: string | null) => {
  if (!refreshToken) return;

  const session = await prisma.adminSession.findUnique({
    where: { refreshToken: hashToken(refreshToken) },
  });
  if (!session || session.revokedAt) return;

  // Only recorded when this request is the one that ended the session.
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.adminSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count > 0) {
      await recordAudit(
        {
          adminId: session.adminId,
          action: auditActions.SIGN_OUT,
          entityType: "AdminSession",
          entityId: session.id,
          ipAddress,
        },
        tx,
      );
    }
  });
};
