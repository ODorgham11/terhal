import { createFactory } from "hono/factory";
import AdminService from "./admin.service.js";
import { acceptAdminInvitationSchema, adminInvitationTokenSchema } from "./admin.validators.js";
import validate from "../../shared/middleware/validate.js";
import { ipKey, rateLimit } from "../../shared/middleware/rateLimit.js";

const factory = createFactory();

const adminService = new AdminService();

// The token is sent in the body rather than the URL, so it never shows up in request logs.
export const lookupAdminInvitationHandler = factory.createHandlers(
    rateLimit({ limit: 30, windowMs: 15 * 60 * 1000, key: ipKey("admin:invitation:lookup") }),
    validate("json", adminInvitationTokenSchema),
    async (c) => {
        const { token } = c.req.valid("json");
        const invitation = await adminService.getInvitation(token);

        return c.json({ success: true, data: { invitation } }, 200);
    }
)

// Creates the account only. Admin sign in doesn't exist yet, so no session is started here.
export const acceptAdminInvitationHandler = factory.createHandlers(
    rateLimit({ limit: 10, windowMs: 60 * 60 * 1000, key: ipKey("admin:invitation:accept") }),
    validate("json", acceptAdminInvitationSchema),
    async (c) => {
        const admin = await adminService.acceptInvitation(c.req.valid("json"));
        return c.json({ success: true, data: { admin } }, 201);
    }
)
