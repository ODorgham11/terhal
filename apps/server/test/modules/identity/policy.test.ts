import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_SESSIONS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  sessionExpiry,
  sessionsToRevoke,
} from "../../../src/modules/identity/domain/policy";

describe("sessionExpiry", () => {
  it("never runs past the absolute lifetime", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-01T11:00:00Z");
    expect(sessionExpiry(later, createdAt).getTime()).toBe(
      createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS,
    );
  });
});

describe("sessionsToRevoke", () => {
  it("leaves room for the new session, revoking the oldest", () => {
    const sessions = Array.from({ length: MAX_ACTIVE_SESSIONS + 1 }, (_, i) => i);
    expect(sessionsToRevoke(sessions)).toEqual([0, 1]);
    expect(sessionsToRevoke(sessions.slice(0, MAX_ACTIVE_SESSIONS - 1))).toEqual([]);
  });
});
