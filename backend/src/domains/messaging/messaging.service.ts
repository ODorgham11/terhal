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
}
