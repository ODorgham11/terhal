import { auditActions } from "@terhal/contracts";
import type { Admin, Prisma } from "../../../../generated/prisma/client";
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
const issueTokens = async (adminId: string, sessionId: string) => {
  const refreshToken = generateToken();
  return {
    accessToken: await signAccessToken("admin", adminId, sessionId),
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
  };
};

// Starts a session for an admin who has fully signed in, keeping at most a few active at once. `via` records how they
// got here: a new account from an invitation, password plus two-factor code, or setting up a new authenticator after a
// two-factor reset.
export const createSession = async (
  admin: Admin,
  via: "invitation" | "password_and_totp" | "two_factor_reset",
  { ipAddress, userAgent }: RequestInfo,
) => {
  const refreshToken = generateToken();
  const refreshTokenHash = hashToken(refreshToken);
  const now = new Date();
  const expiresAt = sessionExpiry(now, now);

  const sessionId = await prisma.$transaction(async (tx) => {
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

    return session.id;
  });

  const accessToken = await signAccessToken("admin", admin.id, sessionId);
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

  const tokens = await issueTokens(session.admin.id, session.id);
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

// Why sessions were ended, recorded on each one.
export type SessionRevokeReason =
  | "revoked_by_owner"
  | "revoked_with_others"
  | "password_reset"
  | "password_changed"
  | "account_deactivated"
  | "two_factor_reset";

// Ends an admin's live sessions (every one, or every one but `except`) inside the caller's transaction, so the change
// that calls for it and the sign out happen together. Each session ended is recorded, like the session limit's, under
// `actorId`: the admin who did it, which may be someone else. Returns how many were ended.
export const revokeAdminSessions = async (
  tx: Prisma.TransactionClient,
  adminId: string,
  {
    reason,
    actorId,
    ipAddress,
    except,
  }: {
    reason: SessionRevokeReason;
    actorId: string | null;
    ipAddress: string | null;
    except?: string;
  },
) => {
  const now = new Date();

  // Returns only the sessions this statement ended, so two requests at once never record one twice.
  const revoked = await tx.adminSession.updateManyAndReturn({
    where: {
      adminId,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(except ? { id: { not: except } } : {}),
    },
    data: { revokedAt: now },
    select: { id: true },
  });

  for (const { id } of revoked) {
    await recordAudit(
      {
        adminId: actorId,
        action: auditActions.SESSION_REVOKED,
        entityType: "AdminSession",
        entityId: id,
        after: { reason },
        ipAddress,
      },
      tx,
    );
  }

  return revoked.length;
};

// The signed in admin's live sessions, newest first, marking the one making this request.
export const listSessions = async (adminId: string, currentSessionId: string) => {
  const sessions = await prisma.adminSession.findMany({
    where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
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

// Ends one of the signed in admin's own sessions, e.g. a device they've lost. Another admin's session, or one that's
// already over, is a 404, so session ids can't be probed.
export const revokeOwnSession = async (
  adminId: string,
  sessionId: string,
  ipAddress: string | null,
) => {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.adminSession.updateMany({
      where: { id: sessionId, adminId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });

    if (count === 0) {
      throw new AppError({
        code: "NOT_FOUND",
        status: 404,
        detail: "There's no such session.",
      });
    }

    await recordAudit(
      {
        adminId,
        action: auditActions.SESSION_REVOKED,
        entityType: "AdminSession",
        entityId: sessionId,
        after: { reason: "revoked_by_owner" satisfies SessionRevokeReason },
        ipAddress,
      },
      tx,
    );
  });
};

// Signs the admin out everywhere except the session making this request.
export const revokeOtherSessions = (
  adminId: string,
  currentSessionId: string,
  ipAddress: string | null,
) =>
  prisma.$transaction((tx) =>
    revokeAdminSessions(tx, adminId, {
      reason: "revoked_with_others",
      actorId: adminId,
      ipAddress,
      except: currentSessionId,
    }),
  );
