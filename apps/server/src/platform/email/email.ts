import { Resend } from "resend";
import { env } from "../config/env";
import { logger } from "../logger/logger";

// Created on first use, so the app can still boot without the API key.
let client: Resend | undefined;

const getClient = () => {
  const key = env.RESEND_KEY;
  if (!key) return undefined;

  client ??= new Resend(key);
  return client;
};

// `html` is an optional rich version of `text`. `idempotencyKey` makes a retried send of the same email a no-op at Resend
// (for 24 hours), so a job that sent but crashed before recording it doesn't email twice. Returns Resend's email id.
export const sendEmail = async (
  to: string,
  subject: string,
  text: string,
  options: { html?: string; idempotencyKey?: string } = {},
): Promise<string | undefined> => {
  const resend = getClient();

  // Without an API key, log emails to the console in development so flows can still be tested locally.
  // In production this throws instead, so links and other sensitive content never end up in the logs.
  if (!resend) {
    if (env.APP_ENV !== "development")
      throw new Error("RESEND_KEY is not defined. Please define it in the environment variables.");

    logger.info(`email to ${to}\nSubject: ${subject}\n\n${text}`);
    return undefined;
  }

  const from = env.RESEND_EMAIL;
  if (!from)
    throw new Error("RESEND_EMAIL is not defined. Please define it in the environment variables.");

  // Resend returns failures instead of throwing them, so turn them into errors for callers to handle.
  const { data, error } = await resend.emails.send(
    { from, to, subject, text, ...(options.html && { html: options.html }) },
    options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  );
  if (error) throw new Error(`Resend failed to send the email: ${error.name}: ${error.message}`);
  return data.id;
};
