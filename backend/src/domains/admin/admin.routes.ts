import { Hono } from "hono";
import { acceptAdminInvitationHandler, lookupAdminInvitationHandler } from "./admin.handlers.js";

const admin = new Hono()
    .post("/invitations/lookup", ...lookupAdminInvitationHandler)
    .post("/invitations/accept", ...acceptAdminInvitationHandler)

export default admin;
