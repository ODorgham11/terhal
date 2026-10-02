import z from "zod";
import { signUpSchema } from "../auth/auth.validators.js";

const tokenSchema = z.string({ error: "Invitation token is required." }).min(1, "Invitation token is required.");

export const inviteStaffSchema = z.object({
    email: signUpSchema.shape.email,
    // What the new staff member can do. "*" is full access, including inviting others.
    permissions: z.array(z.string().trim().min(1)).default([]),
});

export const staffInvitationTokenSchema = z.object({
    token: tokenSchema,
});

// The email comes from the invitation, so it's the one field the invitee doesn't fill in.
export const acceptStaffInvitationSchema = signUpSchema
    .pick({ firstName: true, lastName: true, phone: true, password: true })
    .extend({ token: tokenSchema });

export type AcceptStaffInvitationPayload = z.infer<typeof acceptStaffInvitationSchema>;
