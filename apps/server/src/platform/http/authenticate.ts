import { StaffPermission } from "@terhal/contracts";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  CHALLENGE_LIFETIME,
  signChallenge,
  verifyAccessToken,
  verifyChallenge,
  type Audience,
} from "../crypto/jwt";
import { hashToken } from "../crypto/tokens";
import { prisma } from "../db/prisma";
import { AppError } from "../errors/app-error";

// The frontends and the API are subdomains of the same site (e.g. admin.terhal.co and api.terhal.co), so Lax cookies
// reach the API on the frontends' fetches while staying off requests started by other sites. The cookies are host-only
// on the API, so other subdomains never receive them. Always Secure: local development runs on https too
// (*.local.terhal.co), so it behaves exactly like production.
const baseCookieOptions = { httpOnly: true, secure: true, sameSite: "Lax" } as const;

// Each audience's routes live under their own prefix, and its cookies are only sent there: the access cookie to every
// route of the audience, the refresh token (and the admin's sign in challenge) only to <prefix>/auth, the only routes
// that read them. Customers and guests share the customer site's prefix.
const cookieNames = (audience: Audience, basePath: string) =>
  ({
    accessCookie: `${audience}_access`,
    refreshCookie: `${audience}_refresh`,
    basePath,
    authPath: `${basePath}/auth`,
  }) as const;

export const sessionCookieNames = {
  admin: cookieNames("admin", "/v1/admin"),
  staff: cookieNames("staff", "/v1/staff"),
  customer: cookieNames("customer", "/v1/site"),
} as const satisfies Record<Audience, unknown>;

export const adminCookies = {
  ...sessionCookieNames.admin,
  challengeCookie: "admin_challenge",
} as const;

export const guestCookie = { name: "guest_session", path: "/v1/site" } as const;

export interface SessionCookies {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// The access cookie outlives the token on purpose. If it expired with the token, the browser would drop it and the next
// request would arrive with no token at all, which reads as signed out (UNAUTHENTICATED) instead of expired
// (ACCESS_TOKEN_EXPIRED), so the client would never refresh. The token's own exp claim still limits it.
export const setSession = (c: Context, audience: Audience, session: SessionCookies) => {
  const names = sessionCookieNames[audience];
  setCookie(c, names.accessCookie, session.accessToken, {
    ...baseCookieOptions,
    path: names.basePath,
    expires: session.expiresAt,
  });
  setCookie(c, names.refreshCookie, session.refreshToken, {
    ...baseCookieOptions,
    path: names.authPath,
    expires: session.expiresAt,
  });
};

// Deleting a cookie only works with the same path and options it was set with.
export const clearSession = (c: Context, audience: Audience) => {
  const names = sessionCookieNames[audience];
  deleteCookie(c, names.accessCookie, { ...baseCookieOptions, path: names.basePath });
  deleteCookie(c, names.refreshCookie, { ...baseCookieOptions, path: names.authPath });
};

export const refreshTokenOf = (c: Context, audience: Audience) =>
  getCookie(c, sessionCookieNames[audience].refreshCookie);

// The admin names, kept for the admin module.
export const setAdminSession = (c: Context, session: SessionCookies) => {
  setSession(c, "admin", session);
};
export const clearAdminSession = (c: Context) => {
  clearSession(c, "admin");
};
export const adminRefreshToken = (c: Context) => refreshTokenOf(c, "admin");

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

// A guest's session is an opaque token, checked against GuestSession on every request. The cookie lives as long as the
// session row does.
export const setGuestSession = (c: Context, token: string, expiresAt: Date) => {
  setCookie(c, guestCookie.name, token, {
    ...baseCookieOptions,
    path: guestCookie.path,
    expires: expiresAt,
  });
};

export const clearGuestSession = (c: Context) => {
  deleteCookie(c, guestCookie.name, { ...baseCookieOptions, path: guestCookie.path });
};

export const guestToken = (c: Context) => getCookie(c, guestCookie.name);

// The OpenAPI security schemes routes reference with e.g. `security: [{ [STAFF_COOKIE_AUTH]: [] }]`.
export const ADMIN_COOKIE_AUTH = "adminCookie";
export const STAFF_COOKIE_AUTH = "staffCookie";
export const CUSTOMER_COOKIE_AUTH = "customerCookie";
export const GUEST_COOKIE_AUTH = "guestCookie";

const unauthenticated = () =>
  new AppError({
    code: "UNAUTHENTICATED",
    status: 401,
    detail: "You must be signed in to access this resource.",
  });

const notActive = (who: string) =>
  new AppError({
    code: "ACCOUNT_NOT_ACTIVE",
    status: 403,
    detail: `This ${who} account is not active.`,
  });

// The account and session ids in a valid access cookie for this audience, or a 401.
const accessToken = async (c: Context, audience: Audience) => {
  const token = getCookie(c, sessionCookieNames[audience].accessCookie);
  if (!token) throw unauthenticated();
  return verifyAccessToken(audience, token);
};

// Every require* middleware loads the token's session and its account on every request, in one query. A token can't
// reflect what happened after it was issued, so this is what makes signing out, revoking a session, resetting a
// password, a deactivation or a permission change take effect at once.
const isLive = (
  session: { revokedAt: Date | null; expiresAt: Date } | null,
  ownerId: string | undefined,
  subject: string,
) =>
  session !== null &&
  ownerId === subject &&
  session.revokedAt === null &&
  session.expiresAt > new Date();

export interface AdminActor {
  adminId: string;
  sessionId: string;
}

// The signed in admin's id, on a route behind requireAdmin.
export const currentAdminId = (c: Context) => (c.get("admin") as AdminActor).adminId;
export const currentAdminSessionId = (c: Context) => (c.get("admin") as AdminActor).sessionId;

export const requireAdmin = createMiddleware<{ Variables: { admin: AdminActor } }>(
  async (c, next) => {
    const { subject, sessionId } = await accessToken(c, "admin");
    const session = await prisma.adminSession.findUnique({
      where: { id: sessionId },
      select: {
        adminId: true,
        revokedAt: true,
        expiresAt: true,
        admin: { select: { status: true } },
      },
    });

    if (!session || !isLive(session, session.adminId, subject)) throw unauthenticated();
    if (session.admin.status !== "ACTIVE") throw notActive("admin");

    c.set("admin", { adminId: subject, sessionId });
    await next();
  },
);

export interface StaffActor {
  staffId: string;
  sessionId: string;
  permissions: StaffPermission[];
}

export const currentStaff = (c: Context) => c.get("staff") as StaffActor;

export const requireStaff = createMiddleware<{ Variables: { staff: StaffActor } }>(
  async (c, next) => {
    const { subject, sessionId } = await accessToken(c, "staff");
    const session = await prisma.staffSession.findUnique({
      where: { id: sessionId },
      select: {
        staffId: true,
        revokedAt: true,
        expiresAt: true,
        staff: { select: { status: true, permissions: true } },
      },
    });

    if (!session || !isLive(session, session.staffId, subject)) throw unauthenticated();
    if (session.staff.status !== "ACTIVE") throw notActive("staff");

    // Permissions this version doesn't know (one since removed, say) are dropped rather than failing every request.
    const stored = Array.isArray(session.staff.permissions) ? session.staff.permissions : [];
    const permissions = stored.filter(
      (value): value is StaffPermission => StaffPermission.safeParse(value).success,
    );

    c.set("staff", { staffId: subject, sessionId, permissions });
    await next();
  },
);

const forbidden = () =>
  new AppError({
    code: "FORBIDDEN",
    status: 403,
    detail: "You don't have permission to do this.",
  });

// Goes after requireStaff: a 403 unless the staff member holds every one of these permissions.
export const requirePermission = (...needed: StaffPermission[]) =>
  createMiddleware<{ Variables: { staff: StaffActor } }>(async (c, next) => {
    const { permissions } = c.get("staff");
    if (!needed.every((permission) => permissions.includes(permission))) throw forbidden();
    await next();
  });

// Goes after requireStaff: a 403 unless the staff member holds at least one of these permissions. For reads shared
// across areas, e.g. the driver list, which `fleet` manages and `trips` needs for assigning drivers.
export const requireAnyPermission = (...accepted: [StaffPermission, ...StaffPermission[]]) =>
  createMiddleware<{ Variables: { staff: StaffActor } }>(async (c, next) => {
    const { permissions } = c.get("staff");
    if (!accepted.some((permission) => permissions.includes(permission))) throw forbidden();
    await next();
  });

export interface CustomerActor {
  customerId: string;
  sessionId: string;
}

export const currentCustomerId = (c: Context) => (c.get("customer") as CustomerActor).customerId;

// The signed in customer behind the access cookie, or a 401 (403 when the account isn't active).
const authenticateCustomer = async (c: Context): Promise<CustomerActor> => {
  const { subject, sessionId } = await accessToken(c, "customer");
  const session = await prisma.customerSession.findUnique({
    where: { id: sessionId },
    select: {
      customerId: true,
      revokedAt: true,
      expiresAt: true,
      customer: { select: { status: true } },
    },
  });

  if (!session || !isLive(session, session.customerId, subject)) throw unauthenticated();
  if (session.customer.status !== "ACTIVE") throw notActive("customer");
  return { customerId: subject, sessionId };
};

export const requireCustomer = createMiddleware<{ Variables: { customer: CustomerActor } }>(
  async (c, next) => {
    c.set("customer", await authenticateCustomer(c));
    await next();
  },
);

export interface GuestActor {
  guestSessionId: string;
}

export const currentGuestSessionId = (c: Context) => (c.get("guest") as GuestActor).guestSessionId;

// A guest whose session is verified, unexpired and not revoked.
const authenticateGuest = async (c: Context): Promise<GuestActor> => {
  const token = guestToken(c);
  if (!token) throw unauthenticated();

  const session = await prisma.guestSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, verifiedAt: true, expiresAt: true, revokedAt: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw unauthenticated();
  if (!session.verifiedAt) {
    throw new AppError({
      code: "VERIFICATION_REQUIRED",
      status: 403,
      detail: "Please verify your contact details first.",
    });
  }
  return { guestSessionId: session.id };
};

export const requireGuest = createMiddleware<{ Variables: { guest: GuestActor } }>(
  async (c, next) => {
    c.set("guest", await authenticateGuest(c));
    await next();
  },
);

// Who is booking on the customer site: a signed in customer or a verified guest.
export type Booker = { customerId: string } | { guestSessionId: string };

// For routes open to a customer or a verified guest. A customer's access cookie wins when both are there (someone who
// booked as a guest and then signed in); without one, the guest session is checked.
export const requireBooker = createMiddleware<{
  Variables: { customer?: CustomerActor; guest?: GuestActor };
}>(async (c, next) => {
  if (getCookie(c, sessionCookieNames.customer.accessCookie)) {
    c.set("customer", await authenticateCustomer(c));
  } else {
    c.set("guest", await authenticateGuest(c));
  }
  await next();
});

export const currentBooker = (c: Context): Booker => {
  const customer = c.get("customer") as CustomerActor | undefined;
  return customer
    ? { customerId: customer.customerId }
    : { guestSessionId: currentGuestSessionId(c) };
};
