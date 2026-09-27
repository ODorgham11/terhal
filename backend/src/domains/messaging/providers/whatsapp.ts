export const sendWhatsApp = async (to: string, text: string) => {
    // No WhatsApp provider is connected yet, so messages are logged to the console in development.
    if (process.env.NODE_ENV === "production") {
        // In production this throws instead of logging, so codes and other sensitive content never end up in the logs.
        throw new Error("No WhatsApp provider is configured.");
    }

    console.log(`[whatsapp] to ${to}\n${text}`);
}
