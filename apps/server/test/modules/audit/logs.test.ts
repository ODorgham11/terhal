import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "../../support/database";
import { ADMIN_PASSWORD, createAdmin, totpCode } from "../../support/factories";
import { createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const signedInAgent = async () => {
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
  return agent;
};

describe("the audit log", () => {
  it("is only for signed in admins", async () => {
    expect((await createAgent().request("/v1/admin/logs")).status).toBe(401);
  });

  it("pages through what happened, newest first", async () => {
    const agent = await signedInAgent();

    const first = (await (await agent.request("/v1/admin/logs?limit=1")).json()) as {
      data: { action: string }[];
      nextCursor: string | null;
    };
    expect(first.data.map((log) => log.action)).toEqual(["admin.sign_in.succeeded"]);
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await agent.request(`/v1/admin/logs?limit=1&cursor=${first.nextCursor ?? ""}`)
    ).json()) as { data: { action: string }[] };
    expect(second.data.map((log) => log.action)).toEqual(["admin.sign_in.password_passed"]);
  });

  it("filters by action", async () => {
    const agent = await signedInAgent();
    const response = await agent.request("/v1/admin/logs?action=admin.sign_in.password_passed");
    const body = (await response.json()) as { data: { action: string }[] };
    expect(body.data.map((log) => log.action)).toEqual(["admin.sign_in.password_passed"]);
  });
});
