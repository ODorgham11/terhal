import { timingSafeEqual } from "node:crypto";

// The 6-digit codes customers and guests confirm their contact details with. Pure, so they're tested on their own.

export const VERIFICATION_CODE_LIFETIME_MS = 10 * 60 * 1000;

// A code takes at most this many tries. After that it's dead, and a new one must be requested.
export const MAX_VERIFICATION_ATTEMPTS = 5;

export interface VerificationCodeState {
  verificationHash: string | null;
  verificationExpiresAt: Date | null;
  verificationAttempts: number;
}

export type CodeUsability = "none" | "exhausted" | "expired" | "usable";

// Whether a stored code can still be tried. Checked before comparing, so a dead code never tells whether a guess was
// right.
export const codeUsability = (state: VerificationCodeState, now: Date): CodeUsability => {
  if (!state.verificationHash || !state.verificationExpiresAt) return "none";
  if (state.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) return "exhausted";
  if (state.verificationExpiresAt <= now) return "expired";
  return "usable";
};

export const verificationCodeExpiry = (now: Date) =>
  new Date(now.getTime() + VERIFICATION_CODE_LIFETIME_MS);

// Compares two hashes in constant time, so response times don't reveal how much of a guess was right.
export const hashesMatch = (stored: string, given: string) => {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};
