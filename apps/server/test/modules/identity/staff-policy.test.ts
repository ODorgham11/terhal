import { describe, expect, it } from "vitest";
import {
  STAFF_MAX_ACTIVE_SESSIONS,
  STAFF_SESSION_ABSOLUTE_LIFETIME_MS,
  STAFF_SESSION_SLIDING_LIFETIME_MS,
  staffSessionExpiry,
  staffSessionsToRevoke,
} from "../../../src/modules/identity/domain/policy";

const DAY = 24 * 60 * 60 * 1000;

describe("staffSessionExpiry", () => {
  it("slides 7 days from the latest refresh", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-03T00:00:00Z");
    expect(STAFF_SESSION_SLIDING_LIFETIME_MS).toBe(7 * DAY);
    expect(staffSessionExpiry(now, createdAt).getTime()).toBe(now.getTime() + 7 * DAY);
  });

  it("never runs past 30 days after signing in", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-28T00:00:00Z");
    expect(STAFF_SESSION_ABSOLUTE_LIFETIME_MS).toBe(30 * DAY);
    expect(staffSessionExpiry(later, createdAt).getTime()).toBe(createdAt.getTime() + 30 * DAY);
  });
});

describe("staffSessionsToRevoke", () => {
  it("keeps at most 5 sessions, revoking the oldest", () => {
    expect(STAFF_MAX_ACTIVE_SESSIONS).toBe(5);
    const sessions = Array.from({ length: STAFF_MAX_ACTIVE_SESSIONS + 1 }, (_, i) => i);
    expect(staffSessionsToRevoke(sessions)).toEqual([0, 1]);
    expect(staffSessionsToRevoke(sessions.slice(0, STAFF_MAX_ACTIVE_SESSIONS))).toEqual([0]);
    expect(staffSessionsToRevoke(sessions.slice(0, STAFF_MAX_ACTIVE_SESSIONS - 1))).toEqual([]);
  });
});
