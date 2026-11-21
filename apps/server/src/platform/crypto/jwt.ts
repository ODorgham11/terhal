import { sign, verify } from "hono/jwt";
import { JwtTokenExpired } from "hono/utils/jwt/types";
import { env } from "../config/env";
import { AppError } from "../errors/app-error";

// Who a token was issued to. Each audience has its own secret, so a token from one can never be used as another.
// Guests have no access tokens: their session is an opaque token checked against the database on every request.
export type Audience = "admin" | "staff" | "customer";

const secrets = {
  admin: () => env.ADMIN_SECRET,
  staff: () => env.STAFF_SECRET,
  customer: () => env.CUSTOMER_SECRET,
} satisfies Record<Audience, () => string>;

// 15 minutes: access tokens are checked without a session lookup, so they're kept short.
export const ACCESS_TOKEN_LIFETIME = 15 * 60;

// The step between an admin's correct password and their two-factor code, for 5 minutes. It has its own audience, so it
// can never pass as an access token.
export const CHALLENGE_LIFETIME = 5 * 60;
const challengeAudience = "admin-challenge";

const now = () => Math.floor(Date.now() / 1000);

export const signAccessToken = (audience: Audience, subject: string) =>
  sign(
    { sub: subject, aud: audience, iat: now(), exp: now() + ACCESS_TOKEN_LIFETIME },
    secrets[audience](),
    "HS256",
  );

// The subject, or a 401: ACCESS_TOKEN_EXPIRED tells the client to refresh, UNAUTHENTICATED to sign in again.
export const verifyAccessToken = async (audience: Audience, token: string) => {
  try {
    const payload = await verify(token, secrets[audience](), { alg: "HS256", aud: audience });
    if (typeof payload.sub !== "string") throw new Error("Missing subject.");
    return payload.sub;
  } catch (error) {
    if (error instanceof JwtTokenExpired) {
      throw new AppError({
        code: "ACCESS_TOKEN_EXPIRED",
        status: 401,
        detail: "Your session has expired. Please refresh your access token.",
      });
    }
    throw new AppError({
      code: "UNAUTHENTICATED",
      status: 401,
      detail: "You must be signed in to access this resource.",
    });
  }
};

export const signChallenge = (adminId: string) =>
  sign(
    { sub: adminId, aud: challengeAudience, iat: now(), exp: now() + CHALLENGE_LIFETIME },
    secrets.admin(),
    "HS256",
  );

// The admin id behind a challenge, or null when it's expired or not genuine.
export const verifyChallenge = async (token: string) => {
  try {
    const payload = await verify(token, secrets.admin(), { alg: "HS256", aud: challengeAudience });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
};
