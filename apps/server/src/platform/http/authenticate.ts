import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  CHALLENGE_LIFETIME,
  signChallenge,
  verifyAccessToken,
  verifyChallenge,
} from "../crypto/jwt";
import { prisma } from "../db/prisma";
import { AppError } from "../errors/app-error";

// The frontends and the API are subdomains of the same site (e.g. admin.terhal.co and api.terhal.co), so Lax cookies
// reach the API on the frontends' fetches while staying off requests started by other sites. The cookies are host-only
// on the API, so other subdomains never receive them. Always Secure: local development runs on https too
// (*.local.terhal.co), so it behaves exactly like production.
const baseCookieOptions = { httpOnly: true, secure: true, sameSite: "Lax" } as const;

// The admin routes live under /admin, and the refresh token and sign in challenge are only sent to /admin/auth, the
// only routes that read them.
export const adminCookies = {
  accessCookie: "admin_access",
  refreshCookie: "admin_refresh",
  challengeCookie: "admin_challenge",
  basePath: "/v1/admin",
  authPath: "/v1/admin/auth",
} as const;

export interface AdminSessionCookies {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// The access cookie outlives the token on purpose. If it expired with the token, the browser would drop it and the next
// request would arrive with no token at all, which reads as signed out (UNAUTHENTICATED) instead of expired
// (ACCESS_TOKEN_EXPIRED), so the client would never refresh. The token's own exp claim still limits it.
export const setAdminSession = (c: Context, session: AdminSessionCookies) => {
  setCookie(c, adminCookies.accessCookie, session.accessToken, {
    ...baseCookieOptions,
    path: adminCookies.basePath,
    expires: session.expiresAt,
  });
  setCookie(c, adminCookies.refreshCookie, session.refreshToken, {
    ...baseCookieOptions,
    path: adminCookies.authPath,
    expires: session.expiresAt,
  });
};

// Deleting a cookie only works with the same path and options it was set with.
export const clearAdminSession = (c: Context) => {
  deleteCookie(c, adminCookies.accessCookie, { ...baseCookieOptions, path: adminCookies.basePath });
  deleteCookie(c, adminCookies.refreshCookie, {
    ...baseCookieOptions,
    path: adminCookies.authPath,
  });
};

export const adminRefreshToken = (c: Context) => getCookie(c, adminCookies.refreshCookie);

export const setAdminChallenge = async (c: Context, adminId: string) => {
  setCookie(c, adminCookies.challengeCookie, await signChallenge(adminId), {
    ...baseCookieOptions,
    path: adminCookies.authPath,
    maxAge: CHALLENGE_LIFETIME,
  });
};

// The admin id behind the sign in challenge, or null when it's missing, expired, or not genuine.
export const adminChallenge = async (c: Context) => {
  const token = getCookie(c, adminCookies.challengeCookie);
  return token ? verifyChallenge(token) : null;
};

export const clearAdminChallenge = (c: Context) => {
  deleteCookie(c, adminCookies.challengeCookie, {
    ...baseCookieOptions,
    path: adminCookies.authPath,
  });
};

// The OpenAPI security scheme admin routes reference with `security: [{ [ADMIN_COOKIE_AUTH]: [] }]`.
export const ADMIN_COOKIE_AUTH = "adminCookie";

export interface AdminActor {
  adminId: string;
}

// A signed in, active admin, passed down as c.var.admin. The admin is loaded on every request, since the token can't
// reflect a deactivation made after it was issued: a deactivated admin is cut off immediately.
// The signed in admin's id, on a route behind requireAdmin.
export const currentAdminId = (c: Context) => (c.get("admin") as AdminActor).adminId;

export const requireAdmin = createMiddleware<{ Variables: { admin: AdminActor } }>(
  async (c, next) => {
    const token = getCookie(c, adminCookies.accessCookie);
    if (!token) {
      throw new AppError({
        code: "UNAUTHENTICATED",
        status: 401,
        detail: "You must be signed in to access this resource.",
      });
    }

    const adminId = await verifyAccessToken("admin", token);
    const found = await prisma.admin.findUnique({
      where: { id: adminId },
      select: { status: true },
    });

    if (!found) {
      throw new AppError({
        code: "UNAUTHENTICATED",
        status: 401,
        detail: "You must be signed in to access this resource.",
      });
    }
    if (found.status !== "ACTIVE") {
      throw new AppError({
        code: "ACCOUNT_NOT_ACTIVE",
        status: 403,
        detail: "This admin account is not active.",
      });
    }

    c.set("admin", { adminId });
    await next();
  },
);
