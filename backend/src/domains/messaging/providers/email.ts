export const sendEmail = async (to: string, subject: string, text: string) => {
    // No email provider is connected yet, so emails are logged to the console in development.
    if (process.env.NODE_ENV === "production") {
        // In production this throws instead of logging, so codes and other sensitive content never end up in the logs.
        throw new Error("No email provider is configured.");
    }

    console.log(`[email] to ${to}\nSubject: ${subject}\n\n${text}`);
}
