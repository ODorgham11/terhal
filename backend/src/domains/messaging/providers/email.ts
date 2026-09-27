import { Resend } from "resend";

// Created on first use, so the app can still boot without the API key.
let client: Resend | undefined;

const getClient = () => {
    const key = process.env.RESEND_KEY;
    if (!key) return undefined;

    client ??= new Resend(key);
    return client;
};

export const sendEmail = async (to: string, subject: string, text: string) => {
    const resend = getClient();

    // Without an API key, log emails to the console in development so flows can still be tested locally.
    // In production this throws instead, so codes and other sensitive content never end up in the logs.
    if (!resend) {
        if (process.env.NODE_ENV === "production") throw new Error("RESEND_KEY is not defined. Please define it in the environment variables.");

        console.log(`[email] to ${to}\nSubject: ${subject}\n\n${text}`);
        return;
    }

    const from = process.env.RESEND_EMAIL;
    if (!from) throw new Error("RESEND_EMAIL is not defined. Please define it in the environment variables.");

    // Resend returns failures instead of throwing them, so turn them into errors for callers to handle.
    const { error } = await resend.emails.send({ from, to, subject, text });
    if (error) throw new Error(`Resend failed to send the email: ${error.name}: ${error.message}`);
}
