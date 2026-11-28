// A WhatsApp chat with a phone number (wa.me takes the international number as digits only): how the office and the
// drivers reach people, rather than a phone call.
export const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
