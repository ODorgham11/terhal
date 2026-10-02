import z from "zod";
import { VerificationMethod } from "../../../generated/prisma/enums.js";
import { User } from "../../../generated/prisma/client.js";

export const createUserResponse = (user: User) => {
    return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status
    }
}

// Shared by sign up and sign in, so an identifier is normalized the same way it was stored.
const emailSchema = z
    .string()
    .trim()
    .toLowerCase()
    .max(75, "Email must contain 75 characters at most.")
    .pipe(z.email("Please enter a valid email address."));

const phoneSchema = z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Phone number must be in international format, e.g. +201012345678.");

export const signUpSchema = z.object({
    firstName: z
        .string({ error: "First name is required." })
        .trim()
        .min(2, "First name must contain at least 2 letters.")
        .max(50, "First name must contain 50 letters at most."),
    lastName: z
        .string({ error: "Last name is required." })
        .trim()
        .min(2, "Last name must contain at least 2 letters.")
        .max(50, "Last name must contain 50 letters at most."),
    email: z.string({ error: "Email is required." }).pipe(emailSchema),
    phone: z.string({ error: "Phone number is required." }).pipe(phoneSchema),
    password: z
        .string({ error: "Password is required." })
        .min(8, "Password must contain at least 8 characters.")
        .max(72, "Password must contain 72 characters at most.")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
        .regex(/\d/, "Password must contain at least one number."),
    verificationMethod: z
        .enum(VerificationMethod, { error: `Verification method must be one of: ${Object.values(VerificationMethod).join(", ")}.` })
        .default(VerificationMethod.EMAIL),
})

export type SignUpSchemaPayload = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
    // Resolves to either { email } or { phone }, which can be passed directly as a Prisma unique lookup.
    identifier: z
        .string({ error: "Email or phone number is required." })
        .pipe(
            z.union([
                emailSchema.transform((email) => ({ email })),
                phoneSchema.transform((phone) => ({ phone })),
            ], "Please enter a valid email address or phone number.")),
    password: z
        .string({ error: "Password is required." })
        .min(1, "Password is required."),
})

export type SignInSchemaPayload = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = signInSchema.pick({ identifier: true });

export type ForgotPasswordSchemaPayload = z.infer<typeof forgotPasswordSchema>;

const passwordResetTokenSchema = z.string({ error: "Reset token is required." }).min(1, "Reset token is required.");

export const passwordResetLookupSchema = z.object({
    token: passwordResetTokenSchema,
});

// The new password follows the same rules as sign up.
export const resetPasswordSchema = z.object({
    token: passwordResetTokenSchema,
    password: signUpSchema.shape.password,
});

export type ResetPasswordSchemaPayload = z.infer<typeof resetPasswordSchema>;

export const confirmVerificationSchema = z.object({
    code: z
        .string({ error: "Verification code is required." })
        .trim()
        .regex(/^\d{6}$/, "Please enter the 6-digit code."),
})
