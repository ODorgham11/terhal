import type { Context } from "hono";
import { createFactory } from "hono/factory";
import AuthService from "./auth.service.js";
import { confirmVerificationSchema, signInSchema, signUpSchema } from "./auth.validators.js";
import validate from "../../shared/middleware/validate.js";
import { bodyKey, ipKey, rateLimit } from "../../shared/middleware/rateLimit.js";
import TokenService from "../token/token.service.js";
import { ForbiddenError, UnauthorizedError } from "../../shared/utils/error.js";
import { authorize } from "./auth.middleware.js";
import { UserRole } from "../../../generated/prisma/enums.js";

const factory = createFactory();

const authService = new AuthService();

export const signUpHandler = factory.createHandlers(
    rateLimit({ limit: 5, windowMs: 60 * 60 * 1000, key: ipKey("auth:sign-up") }),
    validate("json", signUpSchema), 
    async (c) => {
        const userPayload = c.req.valid("json");

        const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0].trim() 
            ?? null;
        
        const userAgent = c.req.header("user-agent") ?? null;

        // Create the user and then verify they have actually been created by signing them in.
        await authService.createUser(userPayload);

        // Use the same function we use to sign in a user through the route.
        const tokenPayload = { identifier: { email: userPayload.email }, password: userPayload.password };
        const { user, ...tokens } = await authService.signIn(tokenPayload, ipAddress, userAgent);

        // Tokens are only sent as http-only cookies so they can't be read by scripts on the page.
        TokenService.setAuthenticationCookies(c, "user", tokens);

        // Send the first verification code right away. If it fails the account still exists, and the user can request a new code.
        const verification = await authService.sendVerificationCode(user.id).catch((error) => {
            console.error("Failed to send the verification code on sign up:", error);
            return null;
        });

        return c.json({ success: true, data: { user, verification } }, 201);
    }
)

export const signInHandler = factory.createHandlers(
    rateLimit({ limit: 20, windowMs: 15 * 60 * 1000, key: ipKey("auth:sign-in") }),
    rateLimit({ limit: 10, windowMs: 15 * 60 * 1000, key: bodyKey("auth:sign-in", "identifier", "identifier") }),
    validate("json", signInSchema),
    async (c) => {
        const payload = c.req.valid("json");

        const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0].trim() 
            ?? null;

        const userAgent = c.req.header("user-agent") ?? null;

        const { user, ...tokens } = await authService.signIn(payload, ipAddress, userAgent);

        // Tokens are only sent as http-only cookies so they can't be read by scripts on the page.
        TokenService.setAuthenticationCookies(c, "user", tokens);
        return c.json({ success: true, data: { user } }, 200);
    }
)

export const refreshHandler = factory.createHandlers(
    async (c) => {
        const refreshToken = TokenService.getRefreshToken(c, "user");

        const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0].trim() 
            ?? null;

        const userAgent = c.req.header("user-agent") ?? null;

        try {
            const { user, ...tokens } = await authService.refresh(refreshToken, ipAddress, userAgent);

            // Tokens are only sent as http-only cookies so they can't be read by scripts on the page.
            TokenService.setAuthenticationCookies(c, "user", tokens);
            return c.json({ success: true, data: { user } }, 200);
        } catch (error) {
            // Clear the cookies when the session is over, so the browser stops sending them.
            if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
                TokenService.clearAuthenticationCookies(c, "user");
            }
            
            // Other errors (like the database being down) keep them, since the session may still be valid.
            throw error;
        }
    }
)

export const signOutHandler = factory.createHandlers(
    async (c) => {
        const refreshToken = TokenService.getRefreshToken(c, "user");
        await authService.signOut(refreshToken);

        TokenService.clearAuthenticationCookies(c, "user");
        return c.json({ success: true }, 200);
    }
)

export const sessionHandler = factory.createHandlers(
    authorize([UserRole.CUSTOMER, UserRole.STAFF]),
    async (c) => {
        const user = await authService.getSession(c.var.id);
        return c.json({ success: true, data: { user } }, 200);
    }
)

// Staff are allowed through too. Their accounts are created verified, so they get ALREADY_VERIFIED rather than
// a permissions error, which lets the verify page tell them there's nothing to do.
export const verificationStatusHandler = factory.createHandlers(
    authorize([UserRole.CUSTOMER, UserRole.STAFF]),
    async (c) => {
        const verification = await authService.getVerificationStatus(c.var.id);
        return c.json({ success: true, data: { verification } }, 200);
    }
)

export const sendVerificationHandler = factory.createHandlers(
    authorize([UserRole.CUSTOMER, UserRole.STAFF]),
    rateLimit({ limit: 10, windowMs: 60 * 60 * 1000, key: ipKey("auth:verification:send") }),
    async (c) => {
        const verification = await authService.sendVerificationCode(c.var.id);
        return c.json({ success: true, data: { verification } }, 200);
    }
)

export const confirmVerificationHandler = factory.createHandlers(
    authorize([UserRole.CUSTOMER, UserRole.STAFF]),
    validate("json", confirmVerificationSchema),
    async (c) => {
        const { code } = c.req.valid("json");
        await authService.confirmVerificationCode(c.var.id, code);

        // Issue fresh tokens right away, so they carry verified: true without waiting for the next refresh.
        const refreshToken = TokenService.getRefreshToken(c, "user");

        const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0].trim() 
            ?? null;

        const userAgent = c.req.header("user-agent") ?? null;

        try {
            const { user, ...tokens } = await authService.refresh(refreshToken, ipAddress, userAgent);

            // Tokens are only sent as http-only cookies so they can't be read by scripts on the page.
            TokenService.setAuthenticationCookies(c, "user", tokens);
            return c.json({ success: true, data: { user } }, 200);
        } catch (error) {
            // Clear the cookies when the session is over, so the browser stops sending them.
            if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
                TokenService.clearAuthenticationCookies(c, "user");
            }
            
            // Other errors (like the database being down) keep them, since the session may still be valid.
            throw error;
        }
    }
)