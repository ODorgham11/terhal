import { createMiddleware } from "hono/factory";
import { JwtTokenExpired } from "hono/utils/jwt/types";
import type { UserRole } from "../../../generated/prisma/enums.js";
import TokenService from "../token/token.service.js";
import { ERROR_CODES, ForbiddenError, UnauthorizedError } from "../../shared/utils/error.js";

type AuthorizeOptions = {
    // When true, the user must also have an active, verified account.
    isActive?: boolean;
};

// Makes sure the request comes from a signed in user with one of the allowed roles, and passes their id down as c.var.id.
export const authorize = (roles: UserRole[], { isActive = false }: AuthorizeOptions = {}) => createMiddleware<{ Variables: { id: string } }>(
    async (c, next) => {
        const token = TokenService.getAccessToken(c, "user");
        if (!token) throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);

        // Use a separate code for expired tokens so the client knows to refresh instead of signing out.
        const decoded = await TokenService.verifyAccessToken("user", token).catch((error) => {
            if (error instanceof JwtTokenExpired) throw new UnauthorizedError("Your session has expired. Please refresh your access token.", ERROR_CODES.ACCESS_TOKEN_EXPIRED);
            throw new UnauthorizedError("You must be signed in to access this resource.", ERROR_CODES.UNAUTHENTICATED);
        });

        if (!roles.includes(decoded.role)) throw new ForbiddenError("You are not allowed to access this resource.", ERROR_CODES.INSUFFICIENT_PERMISSIONS);
        if (isActive && !decoded.verified) throw new ForbiddenError("You must verify your account to access this resource.", ERROR_CODES.ACCOUNT_NOT_VERIFIED);

        c.set("id", decoded.sub);
        await next();
    }
);
