import z from "zod";
import { signUpSchema } from "../auth/auth.validators.js";

const tokenSchema = z.string({ error: "Invitation token is required." }).min(1, "Invitation token is required.");

const codeSchema = z
    .string({ error: "Authentication code is required." })
    .trim()
    .regex(/^\d{6}$/, "Please enter the 6-digit code from your authenticator app.");

export const adminInvitationTokenSchema = z.object({
    token: tokenSchema,
});

// Admins have no phone number, and their email comes from the invitation. The code confirms their authenticator app works.
export const acceptAdminInvitationSchema = signUpSchema
    .pick({ firstName: true, lastName: true, password: true })
    .extend({ token: tokenSchema, code: codeSchema });

export type AcceptAdminInvitationPayload = z.infer<typeof acceptAdminInvitationSchema>;

export const adminSignInSchema = z.object({
    email: signUpSchema.shape.email,
    password: z.string({ error: "Password is required." }).min(1, "Password is required."),
});

export const adminVerifySchema = z.object({
    code: codeSchema,
});
