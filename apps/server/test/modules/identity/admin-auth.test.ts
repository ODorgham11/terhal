import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { ADMIN_PASSWORD, createAdmin, createInvitation, totpCode } from "../../support/factories";
import { createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

beforeEach(async () => {
  await Promise.all([resetDatabase(), resetRedis()]);
});

const actions = async () =>
  (await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" }, select: { action: true } })).map(
    (log) => log.action,
  );

describe("accepting an invitation", () => {
  it("sets up two-factor, creates the admin and signs them in", async () => {
    const { token } = await createInvitation("new.admin@terhal.co");
    const agent = createAgent();

    const preview = await agent.request(`/v1/admin/invitations/lookup?token=${token}`);
    expect(await preview.json()).toMatchObject({ email: "new.admin@terhal.co" });

    const totp = await agent.request("/v1/admin/invitations/totp", {
      method: "POST",
      json: { token },
    });
    const { secret } = (await totp.json()) as { secret: string };

    // Asking again hands out the same secret, so an app that's already set up keeps working.
    const again = await agent.request("/v1/admin/invitations/totp", {
      method: "POST",
      json: { token },
    });
    expect(await again.json()).toMatchObject({ secret });

    const accepted = await agent.request("/v1/admin/invitations/accept", {
      method: "POST",
      json: {
        token,
        firstName: "Nour",
        lastName: "Hassan",
        password: ADMIN_PASSWORD,
        code: totpCode(secret),
      },
    });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({ email: "new.admin@terhal.co", status: "ACTIVE" });

    const session = await agent.request("/v1/admin/auth/session");
    expect(await session.json()).toMatchObject({ firstName: "Nour" });

    // The link only works once.
    const reused = await agent.request(`/v1/admin/invitations/lookup?token=${token}`);
    expect(await reused.json()).toMatchObject({ code: "INVITATION_INVALID" });

    expect(await actions()).toEqual([
      auditActions.INVITATION_TOTP_ISSUED,
      auditActions.INVITATION_ACCEPTED,
      auditActions.TOTP_ENABLED,
      auditActions.SIGN_IN_SUCCEEDED,
    ]);
  });

  it("rejects a wrong code without creating the account", async () => {
    const { token } = await createInvitation();
    const agent = createAgent();
    await agent.request("/v1/admin/invitations/totp", { method: "POST", json: { token } });

    const response = await agent.request("/v1/admin/invitations/accept", {
      method: "POST",
      json: {
        token,
        firstName: "Nour",
        lastName: "Hassan",
        password: ADMIN_PASSWORD,
        code: "000000",
      },
    });
    expect(await response.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });
    expect(await prisma.admin.count()).toBe(0);
  });
});

describe("signing in", () => {
  it("takes a password then a code, and refreshes and signs out", async () => {
    const { secret } = await createAdmin("admin@terhal.co");
    const agent = createAgent();

    const signIn = await agent.request("/v1/admin/auth/sign-in", {
      method: "POST",
      json: { email: "Admin@Terhal.co", password: ADMIN_PASSWORD },
    });
    expect(await signIn.json()).toEqual({ twoFactorRequired: true });
    // The password alone never earns a session.
    expect((await agent.request("/v1/admin/auth/session")).status).toBe(401);

    const code = totpCode(secret);
    const verified = await agent.request("/v1/admin/auth/verify", {
      method: "POST",
      json: { code },
    });
    expect(verified.status).toBe(200);
    expect((await agent.request("/v1/admin/auth/session")).status).toBe(200);

    // Refreshing rotates the refresh token: the old one stops working.
    const oldRefresh = agent.jar.get("admin_refresh");
    expect((await agent.request("/v1/admin/auth/refresh", { method: "POST" })).status).toBe(204);
    expect(agent.jar.get("admin_refresh")).not.toBe(oldRefresh);

    expect((await agent.request("/v1/admin/auth/sign-out", { method: "POST" })).status).toBe(204);
    expect((await agent.request("/v1/admin/auth/session")).status).toBe(401);
    expect(await prisma.adminSession.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    await createAdmin("admin@terhal.co");
    const agent = createAgent();

    for (const email of ["admin@terhal.co", "nobody@terhal.co"]) {
      const response = await agent.request("/v1/admin/auth/sign-in", {
        method: "POST",
        json: { email, password: "Wrong-password-1" },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
  });

  it("refuses a code that was already used", async () => {
    const { secret } = await createAdmin();
    const signInWith = async (code: string) => {
      const agent = createAgent();
      await agent.request("/v1/admin/auth/sign-in", {
        method: "POST",
        json: { email: "admin@terhal.co", password: ADMIN_PASSWORD },
      });
      return agent.request("/v1/admin/auth/verify", { method: "POST", json: { code } });
    };

    const code = totpCode(secret);
    expect((await signInWith(code)).status).toBe(200);
    expect(await (await signInWith(code)).json()).toMatchObject({ code: "TOTP_CODE_INVALID" });
  });

  it("cuts a deactivated admin off immediately", async () => {
    const { admin, secret } = await createAdmin();
    const agent = createAgent();
    await agent.request("/v1/admin/auth/sign-in", {
      method: "POST",
      json: { email: "admin@terhal.co", password: ADMIN_PASSWORD },
    });
    await agent.request("/v1/admin/auth/verify", {
      method: "POST",
      json: { code: totpCode(secret) },
    });

    await prisma.admin.update({ where: { id: admin.id }, data: { status: "INACTIVE" } });

    expect(await (await agent.request("/v1/admin/auth/session")).json()).toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });
  });
});
