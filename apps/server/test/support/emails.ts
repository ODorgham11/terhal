import { vi } from "vitest";
import { sendEmail } from "../../src/platform/email/email";

// Reads the emails the app sent. A test file that uses these must replace the email module first, so nothing is sent:
//   vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

const sent = () =>
  vi.mocked(sendEmail).mock.calls.map(([to, subject, text]) => ({ to, subject, text }));

export const emailsTo = (to: string) => sent().filter((email) => email.to === to);

const lastEmailTo = (to: string) => {
  const email = emailsTo(to).at(-1);
  if (!email) throw new Error(`No email was sent to ${to}.`);
  return email;
};

// The verification code in the latest email to this address.
export const lastCodeTo = (to: string) => {
  const code = /\b(\d{6})\b/.exec(lastEmailTo(to).text)?.[1];
  if (!code) throw new Error(`The latest email to ${to} has no code.`);
  return code;
};

// The token in the latest password reset link sent to this address.
export const lastResetTokenTo = (to: string) => {
  const token = /reset-password\?token=([\w-]+)/.exec(lastEmailTo(to).text)?.[1];
  if (!token) throw new Error(`The latest email to ${to} has no reset link.`);
  return token;
};
