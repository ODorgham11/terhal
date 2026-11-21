import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SESSION_ABSOLUTE_LIFETIME_MS,
  CUSTOMER_SESSION_SLIDING_LIFETIME_MS,
  MAX_ACTIVE_CUSTOMER_SESSIONS,
  customerSessionExpiry,
  customerSessionsToRevoke,
} from "../../../src/modules/identity/domain/policy";

const DAY = 24 * 60 * 60 * 1000;

describe("customerSessionExpiry", () => {
  it("slides 30 days from each refresh", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 10 * DAY);
    expect(CUSTOMER_SESSION_SLIDING_LIFETIME_MS).toBe(30 * DAY);
    expect(customerSessionExpiry(now, createdAt).getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it("never runs past 180 days after signing in", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date(createdAt.getTime() + 170 * DAY);
    expect(CUSTOMER_SESSION_ABSOLUTE_LIFETIME_MS).toBe(180 * DAY);
    expect(customerSessionExpiry(now, createdAt).getTime()).toBe(
      createdAt.getTime() + CUSTOMER_SESSION_ABSOLUTE_LIFETIME_MS,
    );
  });
});

describe("customerSessionsToRevoke", () => {
  it("keeps at most 10 active sessions, revoking the oldest", () => {
    expect(MAX_ACTIVE_CUSTOMER_SESSIONS).toBe(10);
    const sessions = Array.from({ length: MAX_ACTIVE_CUSTOMER_SESSIONS }, (_, i) => i);
    expect(customerSessionsToRevoke(sessions)).toEqual([0]);
    expect(customerSessionsToRevoke(sessions.slice(0, -1))).toEqual([]);
  });
});
