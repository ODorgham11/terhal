import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../support/database";
import {
  ADMIN_PASSWORD,
  STAFF_PASSWORD,
  createAdmin,
  createStaff,
  totpCode,
} from "../support/factories";
import { DASHBOARD_ORIGIN, createAgent } from "../support/http";
import { resetRedis } from "../support/redis";

// An access token names its session, and every signed in request checks that session. Ending a session must cut its
// access token off at once, not when the token expires 15 minutes later.

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

describe("ending a session", () => {
  it("cuts off the admin's access token at once", async () => {
    const { secret } = await createAdmin();
    const agent = createAgent();
    await agent.request("/v1/admin/auth/sign-in", {
      method: "POST",
      json: { email: "admin@terhal.co", password: ADMIN_PASSWORD },
    });
    await agent.request("/v1/admin/auth/verify", {
      method: "POST",
      json: { code: totpCode(secret) },
    });
    const access = agent.jar.get("admin_access");
    expect((await agent.request("/v1/admin/auth/session")).status).toBe(200);

    await agent.request("/v1/admin/auth/sign-out", { method: "POST" });

    // A copy of the old access cookie, as an attacker who had stolen it would send it.
    const stale = await createAgent().request("/v1/admin/auth/session", {
      headers: { Cookie: `admin_access=${access ?? ""}` },
    });
    expect(stale.status).toBe(401);
  });

  it("cuts off a staff member's access token at once", async () => {
    await createStaff("staff@terhal.co");
    const agent = createAgent(DASHBOARD_ORIGIN);
    await agent.request("/v1/staff/auth/sign-in", {
      method: "POST",
      json: { email: "staff@terhal.co", password: STAFF_PASSWORD },
    });
    const access = agent.jar.get("staff_access");
    expect((await agent.request("/v1/staff/auth/session")).status).toBe(200);

    await agent.request("/v1/staff/auth/sign-out", { method: "POST" });

    const stale = await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/auth/session", {
      headers: { Cookie: `staff_access=${access ?? ""}` },
    });
    expect(stale.status).toBe(401);
  });
});
