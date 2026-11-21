import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_SESSIONS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  deactivationRefusal,
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

describe("deactivationRefusal", () => {
  it("lets an admin deactivate another while someone stays active", () => {
    expect(deactivationRefusal("a", "b", ["a", "b"])).toBeNull();
    // Deactivating an admin who's already inactive changes nothing, so it's never refused as the last one.
    expect(deactivationRefusal("a", "b", ["a"])).toBeNull();
  });

  it("refuses deactivating yourself", () => {
    expect(deactivationRefusal("a", "a", ["a", "b"])).toBe("self");
  });

  it("refuses deactivating the last active admin", () => {
    // The acting admin was deactivated a moment earlier, so the target is the only one left.
    expect(deactivationRefusal("a", "b", ["b"])).toBe("last_active");
  });
});
