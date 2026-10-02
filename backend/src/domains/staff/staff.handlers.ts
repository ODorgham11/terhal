import { createFactory } from "hono/factory";
import StaffService from "./staff.service.js";
import AuthService from "../auth/auth.service.js";
import TokenService from "../token/token.service.js";
import { acceptStaffInvitationSchema, inviteStaffSchema, staffInvitationTokenSchema } from "./staff.validators.js";
import validate from "../../shared/middleware/validate.js";
import { ipKey, rateLimit } from "../../shared/middleware/rateLimit.js";
import { authorize } from "../auth/auth.middleware.js";
import { ERROR_CODES, ForbiddenError } from "../../shared/utils/error.js";
import { UserRole } from "../../../generated/prisma/enums.js";

const factory = createFactory();

const staffService = new StaffService();
const authService = new AuthService();

export const inviteStaffHandler = factory.createHandlers(
    authorize([UserRole.STAFF], { isActive: true }),
    rateLimit({ limit: 20, windowMs: 60 * 60 * 1000, key: ipKey("staff:invite") }),
    validate("json", inviteStaffSchema),
    async (c) => {
        const { email, permissions } = c.req.valid("json");

        // Only staff with full access can bring in new staff, until finer permissions exist.
        const staff = await staffService.getStaff(c.var.id);
        if (!staff.permissions.includes("*")) throw new ForbiddenError("You are not allowed to invite staff.", ERROR_CODES.INSUFFICIENT_PERMISSIONS);

        const invitation = await staffService.inviteStaff(email, { invitorId: staff.id, permissions });
        return c.json({ success: true, data: { invitation } }, 201);
    }
)

// The token travels in the query string. The request logger redacts it (see shared/middleware/logger.ts).
export const lookupStaffInvitationHandler = factory.createHandlers(
    rateLimit({ limit: 30, windowMs: 15 * 60 * 1000, key: ipKey("staff:invitation:lookup") }),
    validate("query", staffInvitationTokenSchema),
    async (c) => {
        const { token } = c.req.valid("query");
        const invitation = await staffService.getInvitation(token);

        return c.json({ success: true, data: { invitation } }, 200);
    }
)

export const acceptStaffInvitationHandler = factory.createHandlers(
    rateLimit({ limit: 10, windowMs: 60 * 60 * 1000, key: ipKey("staff:invitation:accept") }),
    validate("json", acceptStaffInvitationSchema),
    async (c) => {
        const payload = c.req.valid("json");
        const created = await staffService.acceptInvitation(payload);

        const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0].trim()
            ?? null;

        const userAgent = c.req.header("user-agent") ?? null;

        // Sign them in right away, the same way sign up does.
        const { user, ...tokens } = await authService.signIn({ identifier: { email: created.email }, password: payload.password }, ipAddress, userAgent);

        // Tokens are only sent as http-only cookies so they can't be read by scripts on the page.
        TokenService.setAuthenticationCookies(c, "user", tokens);
        return c.json({ success: true, data: { user } }, 201);
    }
)
