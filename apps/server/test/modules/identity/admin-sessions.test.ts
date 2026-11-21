import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { signIn, signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = ReturnType<typeof createAgent>;

interface Session {
  id: string;
  current: boolean;
  userAgent: string | null;
}

const sessionsOf = async (agent: Agent) => {
  const response = await agent.request("/v1/admin/auth/sessions");
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: Session[] }).data;
};

const currentSessionId = async (agent: Agent) =>
  (await sessionsOf(agent)).find((session) => session.current)?.id ?? "";

const revokedReasons = async () =>
  (
    await prisma.auditLog.findMany({
      where: { action: auditActions.SESSION_REVOKED },
      select: { after: true },
    })
  ).map((log) => (log.after as { reason: string }).reason);

describe("listing sessions", () => {
  it("lists only your live sessions and marks this one", async () => {
    const { secret, agent: laptop } = await signedInAdmin();
    const phone = await signIn("admin@terhal.co", secret);
    await signedInAdmin("other@terhal.co");

    const sessions = await sessionsOf(laptop);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);

    // Each device sees its own session as the current one.
    expect(await currentSessionId(laptop)).not.toBe(await currentSessionId(phone));
  });

  it("needs a signed in admin", async () => {
    expect((await createAgent().request("/v1/admin/auth/sessions")).status).toBe(401);
  });
});

describe("ending a session", () => {
  it("ends another of your devices at once", async () => {
    const { secret, agent: laptop } = await signedInAdmin();
    const phone = await signIn("admin@terhal.co", secret);
    const phoneSession = await currentSessionId(phone);

    const response = await laptop.request(`/v1/admin/auth/sessions/${phoneSession}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);

    expect((await phone.request("/v1/admin/auth/session")).status).toBe(401);
    expect((await laptop.request("/v1/admin/auth/session")).status).toBe(200);
    expect(await revokedReasons()).toEqual(["revoked_by_owner"]);
  });

  it("signs out when it's the current session", async () => {
    const { agent } = await signedInAdmin();

    const response = await agent.request(
      `/v1/admin/auth/sessions/${await currentSessionId(agent)}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(204);
    expect(agent.jar.has("admin_access")).toBe(false);
    expect(agent.jar.has("admin_refresh")).toBe(false);
  });

  it("can't end another admin's session, or an unknown one", async () => {
    const { agent } = await signedInAdmin();
    const { agent: other } = await signedInAdmin("other@terhal.co");
    const otherSession = await currentSessionId(other);

    for (const id of [otherSession, "unknown"]) {
      const response = await agent.request(`/v1/admin/auth/sessions/${id}`, { method: "DELETE" });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await other.request("/v1/admin/auth/session")).status).toBe(200);
  });
});

describe("signing out everywhere else", () => {
  it("ends every other session and keeps this one", async () => {
    const { secret, agent: laptop } = await signedInAdmin();
    const phone = await signIn("admin@terhal.co", secret);
    const tablet = await signIn("admin@terhal.co", secret);
    const { agent: other } = await signedInAdmin("other@terhal.co");

    const response = await laptop.request("/v1/admin/auth/sessions/all/revoke", { method: "POST" });
    expect(response.status).toBe(204);

    expect((await laptop.request("/v1/admin/auth/session")).status).toBe(200);
    for (const agent of [phone, tablet]) {
      expect((await agent.request("/v1/admin/auth/session")).status).toBe(401);
    }
    // Another admin's sessions are untouched.
    expect((await other.request("/v1/admin/auth/session")).status).toBe(200);
    expect(await sessionsOf(laptop)).toEqual([expect.objectContaining({ current: true })]);
    expect(await revokedReasons()).toEqual(["revoked_with_others", "revoked_with_others"]);
  });
});
