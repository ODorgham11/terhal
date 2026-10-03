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
    // In production the frontend and backend are on different sites (two *.vercel.app subdomains), and browsers drop Lax
    // cookies set by a cross-site response, so they're SameSite=None there. None sends the cookies from any site, which is
    // why requireTrustedOrigin rejects unsafe requests from anywhere but FRONTEND_URL. Partitioned keeps them working in
    // browsers that block third-party cookies but allow partitioned ones (e.g. Chrome), since the frontend is always the
    // top-level page. None and Partitioned both require Secure, so local development over http keeps Lax.
    
    // Once both are on one site (e.g. terhal.com and api.terhal.com), go back to Lax everywhere.
    private static readonly baseCookieOptions = process.env.NODE_ENV === "production"
        ? { httpOnly: true, secure: true, sameSite: "None", partitioned: true } as const
        : { httpOnly: true, secure: false, sameSite: "Lax" } as const;

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

        // The cookie outlives the token on purpose. If it expired with the token, the browser would drop it and the next
        // request would arrive with no token at all, which reads as signed out (UNAUTHENTICATED) instead of expired
        // (ACCESS_TOKEN_EXPIRED), so the client would never refresh. The token's own exp claim still limits it to 15 minutes.
        setCookie(c, local.accessCookie, accessToken, {
            ...this.baseCookieOptions,
            path: local.basePath,
            expires: expiresAt,
        });

        // Only sent to the auth routes, which are the only ones that need it.
        setCookie(c, local.refreshCookie, refreshToken, {
            ...this.baseCookieOptions,
            path: local.refreshPath,
            expires: expiresAt,
        });
    }

    // The step between an admin's correct password and their two-factor code. The challenge proves the password was right
    // and names who still owes a code, for 5 minutes. It uses its own audience, so it can never pass as an access token.
    private static readonly CHALLENGE_AUDIENCE = "admin-challenge";
    private static readonly CHALLENGE_COOKIE = "admin_challenge";
    private static readonly CHALLENGE_LIFETIME = 5 * 60;

    static setChallengeCookie = async (c: Context, adminId: string) => {
        const now = Math.floor(Date.now() / 1000);
        const token = await sign({ sub: adminId, aud: this.CHALLENGE_AUDIENCE, iat: now, exp: now + this.CHALLENGE_LIFETIME }, this.getSecret("admin"), "HS256");

        // Only sent to the admin auth routes, which are the only ones that read it.
        setCookie(c, this.CHALLENGE_COOKIE, token, {
            ...this.baseCookieOptions,
            path: config.admin.refreshPath,
            maxAge: this.CHALLENGE_LIFETIME,
        });
    }

    // The admin id behind the challenge, or null when it's missing, expired, or not genuine.
    static verifyChallengeCookie = async (c: Context) => {
        const token = getCookie(c, this.CHALLENGE_COOKIE);
        if (!token) return null;

        try {
            const payload = await verify(token, this.getSecret("admin"), { alg: "HS256", aud: this.CHALLENGE_AUDIENCE });
            return typeof payload.sub === "string" ? payload.sub : null;
        } catch {
            return null;
        }
    }

    // Reads the challenge's admin id without checking the signature. Only for keying rate limits, never for access.
    static peekChallengeCookie = (c: Context) => {
        const token = getCookie(c, this.CHALLENGE_COOKIE);
        if (!token) return undefined;

        try {
            const { sub } = decode(token).payload;
            return typeof sub === "string" ? sub : undefined;
        } catch {
            return undefined;
        }
    }

    static clearChallengeCookie = (c: Context) => {
        deleteCookie(c, this.CHALLENGE_COOKIE, { ...this.baseCookieOptions, path: config.admin.refreshPath });
    }

    // Deleting a cookie only works with the same path and options it was set with.
    static clearAuthenticationCookies = (c: Context, audience: Audience) => {
        const local = config[audience];

        deleteCookie(c, local.accessCookie, { ...this.baseCookieOptions, path: local.basePath });
        deleteCookie(c, local.refreshCookie, { ...this.baseCookieOptions, path: local.refreshPath });
    }
}
