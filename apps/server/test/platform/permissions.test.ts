import type { StaffPermission } from "@terhal/contracts";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { onError } from "../../src/http/errors";
import {
  requireAnyPermission,
  requirePermission,
  requireStaff,
} from "../../src/platform/http/authenticate";
import { resetDatabase } from "../support/database";
import { STAFF_PASSWORD, createStaff } from "../support/factories";
import { DASHBOARD_ORIGIN, createAgent } from "../support/http";
import { resetRedis } from "../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

// Routes guarded both ways, served by a bare app so the checks are tested on their own.
const probe = new Hono()
  .get("/any", requireStaff, requireAnyPermission("fleet", "trips"), (c) => c.text("ok"))
  .get("/all", requireStaff, requirePermission("fleet", "trips"), (c) => c.text("ok"));
probe.onError(onError);

// The access cookie of a staff member holding these permissions.
const cookieFor = async (permissions: StaffPermission[]) => {
  await createStaff("staff@terhal.co", permissions);
  const agent = createAgent(DASHBOARD_ORIGIN);
  const response = await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email: "staff@terhal.co", password: STAFF_PASSWORD },
  });
  expect(response.status).toBe(200);
  return [...agent.jar].map(([name, value]) => `${name}=${value}`).join("; ");
};

const statusOf = async (path: string, cookie: string) =>
  (await probe.request(path, { headers: { Cookie: cookie } })).status;

describe("requireAnyPermission", () => {
  it("lets in a staff member holding any one of the permissions", async () => {
    const cookie = await cookieFor(["trips"]);
    expect(await statusOf("/any", cookie)).toBe(200);
    expect(await statusOf("/all", cookie)).toBe(403);
  });

  it("refuses a staff member holding none of them", async () => {
    const cookie = await cookieFor(["pricing", "team"]);
    expect(await statusOf("/any", cookie)).toBe(403);
  });

  it("still needs a signed in staff member", async () => {
    expect(await statusOf("/any", "")).toBe(401);
  });
});
