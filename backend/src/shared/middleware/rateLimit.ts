import { createHash } from "node:crypto";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import { prisma } from "../utils/prisma.js";
import { ERROR_CODES, TooManyRequestsError } from "../utils/error.js";

// What a limit is counted against.
export type RateLimitSubject = "ip" | "identifier" | "user";

type RateLimitOptions = {
    limit: number;
    windowMs: number;
    key: (c: Context) => string | undefined | Promise<string | undefined>;
};

// Builds every key in the same shape: "<scope>:<subject>:<hash>", e.g. "sign-in:ip:9f86d0…".
export const createRateLimitKey = (scope: string, subject: RateLimitSubject, value: string) => {
    // Values are normalized and hashed, so the table never stores raw IPs, emails or phone numbers.
    const hashed = createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
    return `${scope}:${subject}:${hashed}`;
}

// Vercel sets x-forwarded-for to the real client IP. Without it (e.g. local Docker), fall back to the socket's address.
export const getClientIp = (c: Context) => {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0].trim();
    if (forwarded) return forwarded;

    try {
        return getConnInfo(c).remote.address ?? "unknown";
    } catch {
        return "unknown";
    }
}

// Key builders to pass as rateLimit's key option.
// Counts requests per client IP.
export const ipKey = (scope: string) => (c: Context) => createRateLimitKey(scope, "ip", getClientIp(c));

// Counts requests per value of a JSON body field, e.g. the email or phone being signed into.
// Runs before validation, so it reads the raw body (the validator can still read it afterwards) and skips the limit when the field is missing.
export const bodyKey = (scope: string, subject: RateLimitSubject, field: string) => async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const value = body?.[field];

    return typeof value === "string" ? createRateLimitKey(scope, subject, value) : undefined;
}

// Counts this request and returns the new count, in a single statement so concurrent requests can't slip past the limit.
const consume = async (key: string, windowMs: number) => {
    // Starts a new window when the current one has passed. Uses the database clock (in UTC, like Prisma) for every comparison.
    const [row] = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
        INSERT INTO "RateLimit" ("key", "count", "resetAt")
        VALUES (${key}, 1, (now() AT TIME ZONE 'UTC') + ${windowMs}::double precision * interval '1 millisecond')
        ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE WHEN "RateLimit"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE "RateLimit"."count" + 1 END,
            "resetAt" = CASE WHEN "RateLimit"."resetAt" <= (now() AT TIME ZONE 'UTC') THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
        RETURNING "count", "resetAt"
    `;

    return row;
}

const formatWait = (seconds: number) => {
    if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;

    const minutes = Math.ceil(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export const rateLimit = ({ limit, windowMs, key }: RateLimitOptions) => createMiddleware(
    async (c, next) => {
        const rateLimitKey = await key(c);

        if (rateLimitKey) {
            const { count, resetAt } = await consume(rateLimitKey, windowMs);

            if (count > limit) {
                const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

                c.header("Retry-After", String(retryAfter));
                throw new TooManyRequestsError(`Too many requests. Please try again in ${formatWait(retryAfter)}.`, ERROR_CODES.RATE_LIMITED);
            }
        }

        await next();
    }
);
