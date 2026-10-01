import { Hono } from "hono";
import { acceptStaffInvitationHandler, inviteStaffHandler, lookupStaffInvitationHandler } from "./staff.handlers.js";

const staff = new Hono()
    .post("/invitations", ...inviteStaffHandler)
    .post("/invitations/lookup", ...lookupStaffInvitationHandler)
    .post("/invitations/accept", ...acceptStaffInvitationHandler)

export default staff;
