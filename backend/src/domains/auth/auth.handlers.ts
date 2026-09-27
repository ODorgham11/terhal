import type { Context } from "hono";
import { createFactory } from "hono/factory";
import AuthService from "./auth.service.js";
import { signInSchema, signUpSchema } from "./auth.validators.js";
import validate from "../../shared/middleware/validate.js";
import TokenService from "../token/token.service.js";
import { ForbiddenError, UnauthorizedError } from "../../shared/utils/error.js";
import { authorize } from "./auth.middleware.js";
import { UserRole } from "../../../generated/prisma/enums.js";

const factory = createFactory();

const authService = new AuthService();

export const signUpHandler = factory.createHandlers(
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
        return c.json({ success: true, data: { user } }, 201);
    }
)

export const signInHandler = factory.createHandlers(
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

// Rotates the current session and sets fresh cookies with the user's latest claims (role, verification).
// Used by the refresh route, and by any route that changes what the token should say, e.g. verifying the account.
const reissueTokens = async (c: Context) => {
    const refreshToken = TokenService.getRefreshToken(c, "user");

    const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0].trim() 
        ?? null;

    const userAgent = c.req.header("user-agent") ?? null;

    try {
        const { user, ...tokens } = await authService.refresh(refreshToken, ipAddress, userAgent);

        // Tokens are only sent as http-only cookies so they can't be read by scripts on the page.
        TokenService.setAuthenticationCookies(c, "user", tokens);
        return user;
    } catch (error) {
        // Clear the cookies when the session is over, so the browser stops sending them.
        if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
            TokenService.clearAuthenticationCookies(c, "user");
        }
        
        // Other errors (like the database being down) keep them, since the session may still be valid.
        throw error;
    }
}

export const refreshHandler = factory.createHandlers(
    async (c) => {
        const user = await reissueTokens(c);
        return c.json({ success: true, data: { user } }, 200);
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

export const sendVerificationHandler = factory.createHandlers(
    // Unverified users have to be able to reach this, so the verified check is turned off.
    authorize([UserRole.CUSTOMER], { isActive: false }),
    async (c) => {
        const verification = await authService.sendVerificationCode(c.var.id);
        return c.json({ success: true, data: { verification } }, 200);
    }
)