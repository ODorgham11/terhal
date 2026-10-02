import { VerificationMethod } from "../../../generated/prisma/enums.js";
import { sendEmail } from "./providers/email.js";
import { sendWhatsApp } from "./providers/whatsapp.js";

// The single place that talks to messaging providers, so other domains only say what to send and to whom.
export default class MessagingService {
    // Sends a verification code through the channel the user picked. Throws when the provider fails to deliver it.
    sendVerificationCode = async (method: VerificationMethod, destination: string, code: string) => {
        const message = `Your Terhal verification code is ${code}. It expires in 10 minutes. Don't share this code with anyone.`;

        if (method === VerificationMethod.EMAIL) {
            await sendEmail(destination, "Your Terhal verification code", message);
        } else {
            await sendWhatsApp(destination, message);
        }
    }

    // Sends a link to choose a new password, through the channel the user signs in with. Throws when the provider fails to deliver it.
    sendPasswordReset = async (method: VerificationMethod, destination: string, link: string) => {
        const message = [
            "We received a request to reset your Terhal password.",
            "",
            `Choose a new password here: ${link}`,
            "",
            "This link can only be used once and expires in 30 minutes. If you didn't ask for this, you can ignore this message and your password won't change.",
        ].join("\n");

        if (method === VerificationMethod.EMAIL) {
            await sendEmail(destination, "Reset your Terhal password", message);
        } else {
            await sendWhatsApp(destination, message);
        }
    }

    // Emails a link to create a staff or admin account. Throws when the provider fails to deliver it.
    sendInvitation = async (email: string, role: "staff" | "admin", link: string, expiresAt: Date) => {
        const expires = expiresAt.toUTCString();
        const message = [
            `You've been invited to join Terhal as ${role === "staff" ? "a staff member" : "an admin"}.`,
            "",
            `Create your account here: ${link}`,
            "",
            `This link can only be used once and expires on ${expires}. If you weren't expecting this invitation, you can ignore this email.`,
        ].join("\n");

        await sendEmail(email, `You're invited to join Terhal${role === "admin" ? " as an admin" : ""}`, message);
    }
}
