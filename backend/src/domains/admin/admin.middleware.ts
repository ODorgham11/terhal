import { createMiddleware } from "hono/factory";
import { JwtTokenExpired } from "hono/utils/jwt/types";
import TokenService from "../token/token.service.js";
import { ERROR_CODES, UnauthorizedError } from "../../shared/utils/error.js";

// Makes sure the request comes from a signed in admin, and passes their id down as c.var.id.
// Admin tokens use their own secret and audience, so a user's token can never pass this.
export const authorizeAdmin = () => createMiddleware<{ Variables: { id: string } }>(
    async (c, next) => {
        const token = TokenService.getAccessToken(c, "admin");
        if (!token) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);

        // Use a separate code for expired tokens so the client knows to refresh instead of signing out.
        const decoded = await TokenService.verifyAccessToken("admin", token).catch((error) => {
            if (error instanceof JwtTokenExpired) throw new UnauthorizedError("Your session has expired. Please refresh your access token.", ERROR_CODES.ACCESS_TOKEN_EXPIRED);
            throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        });

        c.set("id", decoded.sub);
        await next();
    }
);
