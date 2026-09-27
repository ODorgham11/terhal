import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { decode, sign, verify } from "hono/jwt";
import type { UserRole } from "../../../generated/prisma/enums.js";

// Who a token was issued to. Each audience has its own secret and cookies, so a token from one can never be used as the other.
export type Audience = "user" | "admin";

// Extra claims carried by each audience's access token.
type AudienceClaims = {
    user: { role: UserRole; verified: boolean };
    admin: {};
};

export type AccessTokenPayload<A extends Audience = Audience> = {
    sub: string;
    aud: A;
    iat: number;
    exp: number;
} & AudienceClaims[A];

type CookiesPayload = {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
};

const config = {
    user: {
        secretVariable: "APP_SECRET",
        accessCookie: "access",
        refreshCookie: "refresh",
        basePath: "/",
        refreshPath: "/auth",
    },
    admin: {
        secretVariable: "ADMIN_SECRET",
        accessCookie: "admin_access",
        refreshCookie: "admin_refresh",
        basePath: "/admin",
        refreshPath: "/admin/auth",
    },
} as const satisfies Record<Audience, Record<string, string>>;

export default class TokenService {
    // Lax requires the frontend and backend to be on the same site (e.g. terhal.com and api.terhal.com).
    // On separate domains (e.g. two *.vercel.app subdomains) the browser won't send these cookies from the frontend at all.
    // If that ever happens, switch to SameSite=None and add a middleware that rejects unsafe requests (POST, PUT, PATCH, DELETE)
    // whose Origin header isn't FRONTEND_URL, since None sends the cookies from any site.
    private static readonly baseCookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
    } as const;

    // Read lazily so the app can still boot without it; only token operations fail.
    private static getSecret = (audience: Audience) => {
        const variable = config[audience].secretVariable;
        const secret = process.env[variable];
        
        if (!secret) throw new Error(`${variable} is not defined. Please define it in the environment variables.`);
        return secret;
    }

    static generateAccessToken = async <A extends Audience>(audience: A, subject: string, claims: AudienceClaims[A]) => {
        const now = Math.floor(Date.now() / 1000);
        const payload = { ...claims, sub: subject, aud: audience, iat: now, exp: now + 15 * 60 };

        return sign(payload, this.getSecret(audience), "HS256");
    }

    // Throws when the token is invalid, expired, or was issued to a different audience.
    static verifyAccessToken = async <A extends Audience>(audience: A, token: string) => {
        return await verify(token, this.getSecret(audience), { alg: "HS256", aud: audience }) as unknown as AccessTokenPayload<A>;
    }

    // Reads the access token from the audience's cookie, undefined when it isn't there.
    static getAccessToken = (c: Context, audience: Audience) => {
        return getCookie(c, config[audience].accessCookie);
    }

    // Reads the refresh token from the audience's cookie, undefined when it isn't there.
    static getRefreshToken = (c: Context, audience: Audience) => {
        return getCookie(c, config[audience].refreshCookie);
    }

    // Refresh tokens are opaque random strings, the session row in the database is what makes them valid.
    static generateRefreshToken = () => {
        return randomBytes(32).toString("base64url");
    }

    // Only the hash is stored, so a leaked database can't be used to hijack sessions.
    static hashRefreshToken = (refreshToken: string) => {
        return createHash("sha256").update(refreshToken).digest("hex");
    }

    static generateTokenPair = async <A extends Audience>(audience: A, subject: string, claims: AudienceClaims[A]) => {
        const accessToken = await this.generateAccessToken(audience, subject, claims);
        const refreshToken = this.generateRefreshToken();

        return {
            accessToken,
            refreshToken,
            refreshTokenHash: this.hashRefreshToken(refreshToken),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        };
    }

    static setAuthenticationCookies = (c: Context, audience: Audience, { accessToken, refreshToken, expiresAt }: CookiesPayload) => {
        const local = config[audience];
        // Expire the cookie together with the token, read from the token itself so the lifetime is defined in one place.
        const { exp } = decode(accessToken).payload;

        setCookie(c, local.accessCookie, accessToken, {
            ...this.baseCookieOptions,
            path: local.basePath,
            expires: new Date(exp! * 1000),
        });

        // Only sent to the auth routes, which are the only ones that need it.
        setCookie(c, local.refreshCookie, refreshToken, {
            ...this.baseCookieOptions,
            path: local.refreshPath,
            expires: expiresAt,
        });
    }

    // Deleting a cookie only works with the same path and options it was set with.
    static clearAuthenticationCookies = (c: Context, audience: Audience) => {
        const local = config[audience];

        deleteCookie(c, local.accessCookie, { ...this.baseCookieOptions, path: local.basePath });
        deleteCookie(c, local.refreshCookie, { ...this.baseCookieOptions, path: local.refreshPath });
    }
}
