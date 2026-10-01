import z from "zod";
import { signUpSchema } from "../auth/auth.validators.js";

const tokenSchema = z.string({ error: "Invitation token is required." }).min(1, "Invitation token is required.");

export const adminInvitationTokenSchema = z.object({
    token: tokenSchema,
});

// Admins have no phone number, and their email comes from the invitation.
export const acceptAdminInvitationSchema = signUpSchema
    .pick({ firstName: true, lastName: true, password: true })
    .extend({ token: tokenSchema });

export type AcceptAdminInvitationPayload = z.infer<typeof acceptAdminInvitationSchema>;
