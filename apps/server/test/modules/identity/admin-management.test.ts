import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deactivateAdmin } from "../../../src/modules/identity/application/admin-management";
import { prisma } from "../../../src/platform/db/prisma";
import { signIn, signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { ADMIN_PASSWORD, createAdmin, totpCode } from "../../support/factories";
import { createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn<(to: string, subject: string, text: string) => Promise<void>>(),
}));
vi.mock("../../../src/platform/email/email", () => ({ sendEmail }));

beforeEach(async () => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  await Promise.all([resetDatabase(), resetRedis()]);
});

type Agent = ReturnType<typeof createAgent>;

const deactivate = (agent: Agent, id: string, code: string) =>
  agent.request(`/v1/admin/admins/${id}/deactivate`, { method: "POST", json: { code } });

const reactivate = (agent: Agent, id: string) =>
  agent.request(`/v1/admin/admins/${id}/reactivate`, { method: "POST" });

const statusOf = async (id: string) =>
  (await prisma.admin.findUniqueOrThrow({ where: { id } })).status;

describe("listing admins", () => {
  it("lists every admin, active or not", async () => {
    const { admin, agent } = await signedInAdmin();
    const { admin: other } = await createAdmin("other@terhal.co");
    await prisma.admin.update({
      where: { id: other.id },
      data: { status: "INACTIVE", totpSecret: null },
    });

    const response = await agent.request("/v1/admin/admins");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        expect.objectContaining({
          id: admin.id,
          email: "admin@terhal.co",
          firstName: "Test",
          lastName: "Admin",
          status: "ACTIVE",
          twoFactorEnabled: true,
          lastLoginAt: expect.any(String) as unknown,
        }),
        expect.objectContaining({
          id: other.id,
          status: "INACTIVE",
          twoFactorEnabled: false,
          lastLoginAt: null,
        }),
      ],
      nextCursor: null,
    });
  });
});

describe("deactivating an admin", () => {
  it("signs them out at once, and reactivating lets them back in", async () => {
    const { admin, agent, secret } = await signedInAdmin();
    const {
      admin: target,
      agent: targetAgent,
      secret: targetSecret,
    } = await signedInAdmin("target@terhal.co");

    const response = await deactivate(agent, target.id, totpCode(secret));
    expect(response.status).toBe(204);
    expect(await statusOf(target.id)).toBe("INACTIVE");

    expect((await targetAgent.request("/v1/admin/auth/session")).status).toBe(401);
    expect(
      await prisma.adminSession.count({ where: { adminId: target.id, revokedAt: null } }),
    ).toBe(0);
    const signInAgain = await createAgent().request("/v1/admin/auth/sign-in", {
      method: "POST",
      json: { email: "target@terhal.co", password: ADMIN_PASSWORD },
    });
    expect(await signInAgain.json()).toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });

    // Deactivating them again changes nothing.
    expect((await deactivate(agent, target.id, totpCode(secret, 1))).status).toBe(204);

    expect((await reactivate(agent, target.id)).status).toBe(204);
    expect(await statusOf(target.id)).toBe("ACTIVE");
    const back = await signIn("target@terhal.co", targetSecret);
    expect((await back.request("/v1/admin/auth/session")).status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: {
        action: { in: [auditActions.ACCOUNT_DEACTIVATED, auditActions.ACCOUNT_REACTIVATED] },
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, adminId: true, entityId: true },
    });
    expect(logs).toEqual([
      { action: auditActions.ACCOUNT_DEACTIVATED, adminId: admin.id, entityId: target.id },
      { action: auditActions.ACCOUNT_REACTIVATED, adminId: admin.id, entityId: target.id },
    ]);
  });

  it("refuses deactivating yourself", async () => {
    const { admin, agent, secret } = await signedInAdmin();
    await createAdmin("other@terhal.co");

    const response = await deactivate(agent, admin.id, totpCode(secret));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "CANNOT_TARGET_SELF" });
    expect(await statusOf(admin.id)).toBe("ACTIVE");
  });

  // An admin who isn't active can't act, so the last active admin could only be deactivated by two admins deactivating
  // each other at once. One of them must lose.
  it("never leaves no admin active, even when two deactivate each other at once", async () => {
    const { admin: first, agent: firstAgent, secret: firstSecret } = await signedInAdmin();
    const {
      admin: second,
      agent: secondAgent,
      secret: secondSecret,
    } = await signedInAdmin("second@terhal.co");

    const responses = await Promise.all([
      deactivate(firstAgent, second.id, totpCode(firstSecret)),
      deactivate(secondAgent, first.id, totpCode(secondSecret)),
    ]);

    // The loser's session was ended (401), or it waited on the winner's lock and found itself deactivated (403).
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401 || status === 403)).toHaveLength(1);
    expect(await prisma.admin.count({ where: { status: "ACTIVE" } })).toBe(1);
  });

  it("refuses an admin deactivated a moment before their own request reaches the lock", async () => {
    const { admin: actor, secret } = await createAdmin();
    const { admin: target } = await createAdmin("target@terhal.co");
    await prisma.admin.update({ where: { id: actor.id }, data: { status: "INACTIVE" } });

    // Past requireAdmin already, as if the other admin's deactivation landed in between.
    await expect(
      deactivateAdmin(target.id, totpCode(secret), actor.id, null),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });
    expect(await statusOf(target.id)).toBe("ACTIVE");
  });

  it("refuses a wrong code, and records it", async () => {
    const { admin, agent } = await signedInAdmin();
    const { admin: target } = await createAdmin("target@terhal.co");

    const response = await deactivate(agent, target.id, "000000");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });
    expect(await statusOf(target.id)).toBe("ACTIVE");
    expect(
      await prisma.auditLog.findMany({
        where: { action: auditActions.STEP_UP_FAILED },
        select: { adminId: true, after: true },
      }),
    ).toEqual([
      { adminId: admin.id, after: { purpose: "deactivate_admin", reason: "wrong_code" } },
    ]);
  });

  it("can't find an unknown admin", async () => {
    const { agent, secret } = await signedInAdmin();
    expect((await deactivate(agent, "unknown", totpCode(secret))).status).toBe(404);
    expect((await reactivate(agent, "unknown")).status).toBe(404);
  });
});
