import { auditActions } from "@terhal/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
});

const NEW_PASSWORD = "New-password-2";

const actions = async () =>
  (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" }, select: { action: true } })).map(
    (log) => log.action,
  );

const requestReset = (email: string) =>
  createAgent().request("/v1/admin/auth/password/reset/request", {
    method: "POST",
    json: { email },
  });

const completeReset = (token: string, code: string, password = NEW_PASSWORD) =>
  createAgent().request("/v1/admin/auth/password/reset/complete", {
    method: "POST",
    json: { token, password, code },
  });

const signInWith = (email: string, password: string) =>
  createAgent().request("/v1/admin/auth/sign-in", {
    method: "POST",
    json: { email, password },
  });

describe("resetting a forgotten password", () => {
  it("answers 202 for an unknown email and sends nothing", async () => {
    const response = await requestReset("nobody@terhal.co");
    expect(response.status).toBe(202);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await actions()).toEqual([]);
  });

  it("sends nothing to an inactive admin, but records the request", async () => {
    const { admin } = await createAdmin();
    await prisma.admin.update({ where: { id: admin.id }, data: { status: "INACTIVE" } });

    expect((await requestReset("admin@terhal.co")).status).toBe(202);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await actions()).toEqual([auditActions.PASSWORD_RESET_REQUESTED]);
  });

  it("takes the admin's code, ends every session and only works once", async () => {
    const { secret, agent: laptop } = await signedInAdmin();
    const phone = await signIn("admin@terhal.co", secret);
    const staleAccess = laptop.jar.get("admin_access") ?? "";

    expect((await requestReset("admin@terhal.co")).status).toBe(202);
    const replaced = lastLinkTokenTo("admin@terhal.co", "reset-password");
    // Asking again replaces the earlier link.
    await requestReset("admin@terhal.co");
    const token = lastLinkTokenTo("admin@terhal.co", "reset-password");
    expect(emailsTo("admin@terhal.co")[0]?.text).toContain(
      "https://admin.local.terhal.co:3000/reset-password?token=",
    );

    expect(await (await completeReset(replaced, totpCode(secret))).json()).toMatchObject({
      code: "PASSWORD_RESET_INVALID",
    });

    // The inbox alone isn't enough: it takes a current code from their authenticator.
    const wrongCode = await completeReset(token, "000000");
    expect(wrongCode.status).toBe(400);
    expect(await wrongCode.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });

    expect((await completeReset(token, totpCode(secret))).status).toBe(204);

    // Every session ends at once, including access tokens already handed out.
    const stale = await createAgent().request("/v1/admin/auth/session", {
      headers: { Cookie: `admin_access=${staleAccess}` },
    });
    expect(stale.status).toBe(401);
    for (const agent of [laptop, phone]) {
      expect((await agent.request("/v1/admin/auth/session")).status).toBe(401);
    }

    expect((await signInWith("admin@terhal.co", ADMIN_PASSWORD)).status).toBe(401);
    expect((await signInWith("admin@terhal.co", NEW_PASSWORD)).status).toBe(200);

    const reused = await completeReset(token, totpCode(secret, 1), "Another-password-3");
    expect(await reused.json()).toMatchObject({ code: "PASSWORD_RESET_INVALID" });

    expect(await actions()).toEqual(
      expect.arrayContaining([
        auditActions.PASSWORD_RESET_REQUESTED,
        auditActions.STEP_UP_FAILED,
        auditActions.SESSION_REVOKED,
        auditActions.PASSWORD_RESET,
      ]),
    );
  });

  it("expires the link after 15 minutes", async () => {
    const { secret } = await createAdmin();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });

    await requestReset("admin@terhal.co");
    const token = lastLinkTokenTo("admin@terhal.co", "reset-password");

    vi.setSystemTime(Date.now() + 15 * 60 * 1000 + 1000);
    const response = await completeReset(token, totpCode(secret));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "PASSWORD_RESET_EXPIRED" });
  });

  it("refuses an inactive admin", async () => {
    const { admin, secret } = await createAdmin();
    await requestReset("admin@terhal.co");
    const token = lastLinkTokenTo("admin@terhal.co", "reset-password");
    await prisma.admin.update({ where: { id: admin.id }, data: { status: "INACTIVE" } });

    const response = await completeReset(token, totpCode(secret));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
  });

  it("asks an admin whose two-factor is being reset to set it up first", async () => {
    const { admin, secret } = await createAdmin();
    await requestReset("admin@terhal.co");
    const token = lastLinkTokenTo("admin@terhal.co", "reset-password");
    await prisma.admin.update({ where: { id: admin.id }, data: { totpSecret: null } });

    const response = await completeReset(token, totpCode(secret));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "TOTP_SETUP_REQUIRED" });
  });
});

describe("changing a password", () => {
  const change = (
    agent: ReturnType<typeof createAgent>,
    code: string,
    currentPassword = ADMIN_PASSWORD,
  ) =>
    agent.request("/v1/admin/auth/password", {
      method: "POST",
      json: { currentPassword, newPassword: NEW_PASSWORD, code },
    });

  it("keeps this session and ends the others", async () => {
    const { secret, agent: laptop } = await signedInAdmin();
    const phone = await signIn("admin@terhal.co", secret);

    expect((await change(laptop, totpCode(secret))).status).toBe(204);

    expect((await laptop.request("/v1/admin/auth/session")).status).toBe(200);
    expect((await phone.request("/v1/admin/auth/session")).status).toBe(401);
    expect((await signInWith("admin@terhal.co", NEW_PASSWORD)).status).toBe(200);
    expect(await actions()).toContain(auditActions.PASSWORD_CHANGED);
  });

  it("refuses a wrong current password", async () => {
    const { secret, agent } = await signedInAdmin();

    const response = await change(agent, totpCode(secret), "Wrong-password-1");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    // Still signed in: a wrong password here isn't a failed sign in.
    expect((await agent.request("/v1/admin/auth/session")).status).toBe(200);
  });

  it("refuses a wrong or reused code", async () => {
    const { secret, agent } = await signedInAdmin();

    expect(await (await change(agent, "000000")).json()).toMatchObject({
      code: "TOTP_CODE_INVALID",
    });

    const code = totpCode(secret);
    expect((await change(agent, code)).status).toBe(204);
    const reused = await agent.request("/v1/admin/auth/password", {
      method: "POST",
      json: { currentPassword: NEW_PASSWORD, newPassword: "Another-password-3", code },
    });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });
  });
});
