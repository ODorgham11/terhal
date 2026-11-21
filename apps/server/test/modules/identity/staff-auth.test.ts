import { auditActions, staffPermissions } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import {
  ADMIN_PASSWORD,
  STAFF_PASSWORD,
  createAdmin,
  createStaff,
  totpCode,
} from "../../support/factories";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

// Emails are caught here instead of sent, so tests can follow the links in them.
const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn<(to: string, subject: string, text: string) => Promise<void>>(),
}));
vi.mock("../../../src/platform/email/email", () => ({ sendEmail }));

beforeEach(async () => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  await Promise.all([resetDatabase(), resetRedis()]);
});

const NEW_PASSWORD = "New-password-2";

// The token in the link of the latest email sent to this address.
const linkToken = (to: string, path: "invite" | "reset-password") => {
  const call = sendEmail.mock.calls.filter(([recipient]) => recipient === to).at(-1);
  const match = call?.[2].match(new RegExp(`${DASHBOARD_ORIGIN}/${path}\\?token=([\\w-]+)`));
  if (!match?.[1]) throw new Error(`No ${path} link was emailed to ${to}.`);
  return match[1];
};

const signedInAdmin = async () => {
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

const signIn = async (email = "staff@terhal.co", password = STAFF_PASSWORD) => {
  const agent = createAgent(DASHBOARD_ORIGIN);
  const response = await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email, password },
  });
  return { agent, response };
};

const accept = (agent: ReturnType<typeof createAgent>, token: string) =>
  agent.request("/v1/staff/invitations/accept", {
    method: "POST",
    json: {
      token,
      firstName: "Mona",
      lastName: "Adel",
      phone: "01001234567",
      password: STAFF_PASSWORD,
    },
  });

describe("inviting staff from the admin panel", () => {
  it("emails a link that creates the staff member and signs them in", async () => {
    const admin = await signedInAdmin();

    const invited = await admin.request("/v1/admin/staff/invitations", {
      method: "POST",
      json: { email: "Mona@Terhal.co" },
    });
    expect(invited.status).toBe(201);
    expect(await invited.json()).toMatchObject({ email: "mona@terhal.co" });

    // One message, Arabic first, then English.
    const [, subject, text] = sendEmail.mock.calls[0] ?? [];
    expect(subject).toMatch(/^دعوة/);
    expect(text?.indexOf("تمت دعوتك")).toBeLessThan(text?.indexOf("You've been invited") ?? 0);

    const token = linkToken("mona@terhal.co", "invite");
    const staff = createAgent(DASHBOARD_ORIGIN);

    const preview = await staff.request(`/v1/staff/invitations/lookup?token=${token}`);
    expect(await preview.json()).toMatchObject({
      email: "mona@terhal.co",
      permissions: [...staffPermissions],
    });

    const accepted = await accept(staff, token);
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({
      email: "mona@terhal.co",
      phone: "+201001234567",
      status: "ACTIVE",
      permissions: [...staffPermissions],
    });

    const session = await staff.request("/v1/staff/auth/session");
    expect(await session.json()).toMatchObject({
      firstName: "Mona",
      permissions: [...staffPermissions],
    });

    // The link only works once.
    const reused = await accept(createAgent(DASHBOARD_ORIGIN), token);
    expect(await reused.json()).toMatchObject({ code: "INVITATION_INVALID" });

    const invitation = await prisma.staffInvitation.findFirstOrThrow();
    expect(invitation.invitorId).toBeNull();
    expect(invitation.acceptedAt).not.toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { action: auditActions.STAFF_INVITED } });
    expect(logs).toMatchObject([{ entityType: "StaffInvitation", entityId: invitation.id }]);
  });

  it("refuses an email that already belongs to staff", async () => {
    await createStaff("staff@terhal.co");
    const admin = await signedInAdmin();

    const response = await admin.request("/v1/admin/staff/invitations", {
      method: "POST",
      json: { email: "staff@terhal.co", permissions: ["trips"] },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("inviting staff from the dashboard", () => {
  it("needs the team permission", async () => {
    await createStaff("staff@terhal.co", ["trips"]);
    const { agent } = await signIn();

    const response = await agent.request("/v1/staff/invitations", {
      method: "POST",
      json: { email: "new@terhal.co", permissions: ["trips"] },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.staffInvitation.count()).toBe(0);
  });

  it("gives the invitee the chosen permissions, and inviting again revokes the earlier link", async () => {
    const inviter = await createStaff("lead@terhal.co", ["team"]);
    const { agent } = await signIn("lead@terhal.co");

    const invite = (permissions: string[]) =>
      agent.request("/v1/staff/invitations", {
        method: "POST",
        json: { email: "new@terhal.co", permissions },
      });

    expect((await invite(["trips"])).status).toBe(201);
    const first = linkToken("new@terhal.co", "invite");
    expect((await invite(["trips", "fleet"])).status).toBe(201);
    const second = linkToken("new@terhal.co", "invite");

    const invitee = createAgent(DASHBOARD_ORIGIN);
    expect(await (await accept(invitee, first)).json()).toMatchObject({
      code: "INVITATION_INVALID",
    });
    expect(await (await accept(invitee, second)).json()).toMatchObject({
      permissions: ["trips", "fleet"],
    });

    const invitations = await prisma.staffInvitation.findMany();
    expect(invitations.every((invitation) => invitation.invitorId === inviter.id)).toBe(true);
  });

  it("refuses an email that already belongs to staff", async () => {
    await createStaff("lead@terhal.co", ["team"]);
    const { agent } = await signIn("lead@terhal.co");

    const response = await agent.request("/v1/staff/invitations", {
      method: "POST",
      json: { email: "lead@terhal.co", permissions: [] },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });
  });
});

describe("signing in", () => {
  it("signs in, refreshes and signs out", async () => {
    const created = await createStaff("staff@terhal.co", ["trips"]);
    const { agent, response } = await signIn("Staff@Terhal.co");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: created.id,
      firstName: "Test",
      lastName: "Staff",
      email: "staff@terhal.co",
      phone: null,
      status: "ACTIVE",
      permissions: ["trips"],
      locale: "ar",
    });
    expect(
      (await prisma.staff.findUniqueOrThrow({ where: { id: created.id } })).lastLoginAt,
    ).not.toBeNull();
    expect((await agent.request("/v1/staff/auth/session")).status).toBe(200);

    // Refreshing rotates the refresh token: the old one stops working.
    const oldRefresh = agent.jar.get("staff_refresh");
    expect((await agent.request("/v1/staff/auth/refresh", { method: "POST" })).status).toBe(204);
    expect(agent.jar.get("staff_refresh")).not.toBe(oldRefresh);

    expect((await agent.request("/v1/staff/auth/sign-out", { method: "POST" })).status).toBe(204);
    expect((await agent.request("/v1/staff/auth/session")).status).toBe(401);
    expect(await prisma.staffSession.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    await createStaff("staff@terhal.co");

    for (const email of ["staff@terhal.co", "nobody@terhal.co"]) {
      const { response } = await signIn(email, "Wrong-password-1");
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
  });

  it("blocks a suspended staff member, and cuts off one already signed in", async () => {
    const staff = await createStaff("staff@terhal.co");
    const { agent } = await signIn();

    await prisma.staff.update({ where: { id: staff.id }, data: { status: "SUSPENDED" } });

    expect(await (await agent.request("/v1/staff/auth/session")).json()).toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });
    const refreshed = await agent.request("/v1/staff/auth/refresh", { method: "POST" });
    expect(await refreshed.json()).toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
    expect(await prisma.staffSession.count({ where: { revokedAt: null } })).toBe(0);

    const { response } = await signIn();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
  });
});

describe("resetting a password", () => {
  const requestReset = (email: string) =>
    createAgent(DASHBOARD_ORIGIN).request("/v1/staff/auth/password/reset/request", {
      method: "POST",
      json: { email },
    });

  const completeReset = (token: string, password = NEW_PASSWORD) =>
    createAgent(DASHBOARD_ORIGIN).request("/v1/staff/auth/password/reset/complete", {
      method: "POST",
      json: { token, password },
    });

  it("never says whether the email belongs to staff", async () => {
    const response = await requestReset("nobody@terhal.co");
    expect(response.status).toBe(202);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sets the new password, signs out everywhere and only works once", async () => {
    await createStaff("staff@terhal.co");
    const { agent: laptop } = await signIn();
    const { agent: phone } = await signIn();

    expect((await requestReset("staff@terhal.co")).status).toBe(202);
    const replaced = linkToken("staff@terhal.co", "reset-password");
    // Asking again replaces the earlier link.
    expect((await requestReset("staff@terhal.co")).status).toBe(202);
    const token = linkToken("staff@terhal.co", "reset-password");

    const [, subject] = sendEmail.mock.calls[0] ?? [];
    expect(subject).toMatch(/^إعادة تعيين/);

    expect(await (await completeReset(replaced)).json()).toMatchObject({
      code: "PASSWORD_RESET_INVALID",
    });
    expect((await completeReset(token)).status).toBe(204);

    for (const agent of [laptop, phone]) {
      const refreshed = await agent.request("/v1/staff/auth/refresh", { method: "POST" });
      expect(await refreshed.json()).toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
    }
    expect(await prisma.staffSession.count({ where: { revokedAt: null } })).toBe(0);

    expect((await signIn("staff@terhal.co", STAFF_PASSWORD)).response.status).toBe(401);
    expect((await signIn("staff@terhal.co", NEW_PASSWORD)).response.status).toBe(200);

    expect(await (await completeReset(token, "Another-password-3")).json()).toMatchObject({
      code: "PASSWORD_RESET_INVALID",
    });
  });

  it("refuses an expired link", async () => {
    const staff = await createStaff("staff@terhal.co");
    await requestReset("staff@terhal.co");
    const token = linkToken("staff@terhal.co", "reset-password");

    await prisma.staff.update({
      where: { id: staff.id },
      data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await (await completeReset(token)).json()).toMatchObject({
      code: "PASSWORD_RESET_EXPIRED",
    });
  });
});
