import { describe, expect, it } from "vitest";
import {
  MAX_VERIFICATION_ATTEMPTS,
  VERIFICATION_CODE_LIFETIME_MS,
  codeUsability,
  hashesMatch,
  verificationCodeExpiry,
  type VerificationCodeState,
} from "../../../src/modules/identity/domain/verification-codes";

const now = new Date("2026-01-01T12:00:00Z");

const code = (overrides: Partial<VerificationCodeState> = {}): VerificationCodeState => ({
  verificationHash: "a".repeat(64),
  verificationExpiresAt: verificationCodeExpiry(now),
  verificationAttempts: 0,
  ...overrides,
});

describe("codeUsability", () => {
  it("lasts 10 minutes", () => {
    expect(VERIFICATION_CODE_LIFETIME_MS).toBe(10 * 60 * 1000);
    expect(codeUsability(code(), now)).toBe("usable");
    const later = new Date(now.getTime() + VERIFICATION_CODE_LIFETIME_MS);
    expect(codeUsability(code(), later)).toBe("expired");
  });

  it("dies after 5 tries", () => {
    expect(MAX_VERIFICATION_ATTEMPTS).toBe(5);
    expect(codeUsability(code({ verificationAttempts: 4 }), now)).toBe("usable");
    expect(codeUsability(code({ verificationAttempts: 5 }), now)).toBe("exhausted");
  });

  it("knows when there's no code at all", () => {
    expect(codeUsability(code({ verificationHash: null }), now)).toBe("none");
    expect(codeUsability(code({ verificationExpiresAt: null }), now)).toBe("none");
  });
});

describe("hashesMatch", () => {
  it("matches only the same hash", () => {
    expect(hashesMatch("abc", "abc")).toBe(true);
    expect(hashesMatch("abc", "abd")).toBe(false);
    expect(hashesMatch("abc", "abcd")).toBe(false);
  });
});
