import { createMiddleware } from "hono/factory";
import { ERROR_CODES, ForbiddenError } from "../utils/error.js";

// In production the auth cookies are SameSite=None, so the browser attaches them to requests from any site. This rejects
// unsafe requests a browser sent from any page other than the frontend, so another site can't act with a user's session.

export const requireOrigin = (value: string) => createMiddleware(async (c, next) => {
    const origin = c.req.header("origin");
    
    // Browsers always send Origin on these methods and pages can't change it. Requests without one aren't from a browser,
    // so they don't carry anyone else's cookies and are let through.
    if (new Set(["POST", "PUT", "PATCH", "DELETE"]).has(c.req.method) && origin !== undefined && origin !== value) {
        throw new ForbiddenError("Requests from this origin are not allowed.", ERROR_CODES.UNTRUSTED_ORIGIN);
    }

    await next();
});
