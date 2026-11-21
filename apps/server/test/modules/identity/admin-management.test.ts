import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deactivateAdmin } from "../../../src/modules/identity/application/admin-management";
import { prisma } from "../../../src/platform/db/prisma";
import { signIn, signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { emailsTo, lastLinkTokenTo } from "../../support/emails";
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

const resetTwoFactor = (agent: Agent, id: string, code: string) =>
  agent.request(`/v1/admin/admins/${id}/reset/two-factor`, { method: "POST", json: { code } });

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

describe("resetting an admin's two-factor", () => {
  const setup = (token: string) =>
    createAgent().request("/v1/admin/auth/two-factor/setup", { method: "POST", json: { token } });

  it("locks them out until they set up a new authenticator with their password", async () => {
    const { agent, secret } = await signedInAdmin();
    const {
      admin: target,
      agent: targetAgent,
      secret: oldSecret,
    } = await signedInAdmin("target@terhal.co");

    expect((await resetTwoFactor(agent, target.id, totpCode(secret))).status).toBe(204);

    // Every session of theirs ends, and they can't sign in.
    expect((await targetAgent.request("/v1/admin/auth/session")).status).toBe(401);
    const signInAttempt = await createAgent().request("/v1/admin/auth/sign-in", {
      method: "POST",
      json: { email: "target@terhal.co", password: ADMIN_PASSWORD },
    });
    expect(signInAttempt.status).toBe(403);
    expect(await signInAttempt.json()).toMatchObject({ code: "TOTP_SETUP_REQUIRED" });

    expect(emailsTo("target@terhal.co")[0]?.text).toContain(
      "https://admin.local.terhal.co:3000/two-factor/setup?token=",
    );
    const token = lastLinkTokenTo("target@terhal.co", "two-factor/setup");

    const first = await setup(token);
    expect(first.status).toBe(200);
    const { secret: newSecret } = (await first.json()) as { secret: string };
    expect(newSecret).not.toBe(oldSecret);
    // Asking again returns the same secret.
    expect(await (await setup(token)).json()).toMatchObject({ secret: newSecret });

    const device = createAgent();
    const confirm = (password: string, code: string) =>
      device.request("/v1/admin/auth/two-factor/confirm", {
        method: "POST",
        json: { token, password, code },
      });

    const wrongPassword = await confirm("Wrong-password-1", totpCode(newSecret));
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });

    const oldCode = await confirm(ADMIN_PASSWORD, totpCode(oldSecret));
    expect(oldCode.status).toBe(400);
    expect(await oldCode.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });

    const confirmed = await confirm(ADMIN_PASSWORD, totpCode(newSecret));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ email: "target@terhal.co" });
    expect((await device.request("/v1/admin/auth/session")).status).toBe(200);

    // The link only works once, and the new authenticator is the one that signs them in.
    expect(await (await setup(token)).json()).toMatchObject({ code: "TWO_FACTOR_RESET_INVALID" });
    await prisma.admin.update({ where: { id: target.id }, data: { totpLastUsedStep: null } });
    const again = await signIn("target@terhal.co", newSecret);
    expect((await again.request("/v1/admin/auth/session")).status).toBe(200);

    const actions = (
      await prisma.auditLog.findMany({
        where: {
          action: {
            in: [
              auditActions.TOTP_RESET,
              auditActions.TOTP_RESET_ISSUED,
              auditActions.TOTP_RESET_CONFIRM_FAILED,
              auditActions.TOTP_ENABLED,
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        select: { action: true },
      })
    ).map((log) => log.action);
    expect(actions).toEqual([
      auditActions.TOTP_RESET,
      auditActions.TOTP_RESET_ISSUED,
      auditActions.TOTP_RESET_CONFIRM_FAILED,
      auditActions.TOTP_RESET_CONFIRM_FAILED,
      auditActions.TOTP_ENABLED,
    ]);
  });

  it("refuses an expired or unknown link", async () => {
    const { agent, secret } = await signedInAdmin();
    const { admin: target } = await createAdmin("target@terhal.co");
    await resetTwoFactor(agent, target.id, totpCode(secret));
    const token = lastLinkTokenTo("target@terhal.co", "two-factor/setup");

    await prisma.admin.update({
      where: { id: target.id },
      data: { twoFactorResetExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await (await setup(token)).json()).toMatchObject({ code: "TWO_FACTOR_RESET_EXPIRED" });
    expect(await (await setup("x".repeat(43))).json()).toMatchObject({
      code: "TWO_FACTOR_RESET_INVALID",
    });
  });

  it("refuses resetting yourself or an inactive admin, and a wrong code", async () => {
    const { admin, agent, secret } = await signedInAdmin();
    const { admin: target } = await createAdmin("target@terhal.co");

    const self = await resetTwoFactor(agent, admin.id, totpCode(secret));
    expect(self.status).toBe(400);
    expect(await self.json()).toMatchObject({ code: "CANNOT_TARGET_SELF" });

    const wrong = await resetTwoFactor(agent, target.id, "000000");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });

    await prisma.admin.update({ where: { id: target.id }, data: { status: "INACTIVE" } });
    const inactive = await resetTwoFactor(agent, target.id, totpCode(secret));
    expect(inactive.status).toBe(409);
    expect(await inactive.json()).toMatchObject({ code: "ADMIN_NOT_ACTIVE" });

    expect((await resetTwoFactor(agent, "unknown", totpCode(secret, 1))).status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
