import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const invite = (agent: Agent, email: string, code: string) =>
  agent.request("/v1/admin/invitations", { method: "POST", json: { email, code } });

const auditedActions = async (action: string) =>
  prisma.auditLog.findMany({ where: { action }, select: { adminId: true, after: true } });

describe("inviting an admin", () => {
  it("emails a link the invitee accepts, and they can then sign in", async () => {
    const { admin, agent, secret } = await signedInAdmin();

    const sent = await invite(agent, "second@terhal.co", totpCode(secret));
    expect(sent.status).toBe(201);
    const body = (await sent.json()) as { email: string; expiresAt: string };
    expect(body.email).toBe("second@terhal.co");
    // Valid for 48 hours.
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000);

    expect(emailsTo("second@terhal.co")[0]?.text).toContain(
      "https://admin.local.terhal.co:3000/invite?token=",
    );
    const token = lastLinkTokenTo("second@terhal.co", "invite");

    const invitee = createAgent();
    const preview = await invitee.request(`/v1/admin/invitations/lookup?token=${token}`);
    expect(await preview.json()).toMatchObject({ email: "second@terhal.co" });

    const totp = await invitee.request("/v1/admin/invitations/totp", {
      method: "POST",
      json: { token },
    });
    const { secret: inviteeSecret } = (await totp.json()) as { secret: string };

    const accepted = await invitee.request("/v1/admin/invitations/accept", {
      method: "POST",
      json: {
        token,
        firstName: "Second",
        lastName: "Admin",
        password: ADMIN_PASSWORD,
        code: totpCode(inviteeSecret),
      },
    });
    expect(accepted.status).toBe(201);

    // Signing in afresh works too, with a newer code.
    await prisma.admin.update({
      where: { email: "second@terhal.co" },
      data: { totpLastUsedStep: null },
    });
    const again = await signIn("second@terhal.co", inviteeSecret);
    expect((await again.request("/v1/admin/auth/session")).status).toBe(200);

    const [accept] = await auditedActions(auditActions.INVITATION_ACCEPTED);
    expect(accept?.after).toMatchObject({ invitedBy: admin.id });
    const [audit] = await auditedActions(auditActions.INVITATION_SENT);
    expect(audit).toMatchObject({ adminId: admin.id, after: { email: "second@terhal.co" } });
  });

  it("refuses an email that already belongs to an admin", async () => {
    const { agent, secret } = await signedInAdmin();
    await createAdmin("taken@terhal.co");

    const response = await invite(agent, "taken@terhal.co", totpCode(secret));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a wrong or reused code, and records it", async () => {
    const { admin, agent, secret } = await signedInAdmin();

    const wrong = await invite(agent, "second@terhal.co", "000000");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });

    const code = totpCode(secret);
    expect((await invite(agent, "second@terhal.co", code)).status).toBe(201);
    const reused = await invite(agent, "third@terhal.co", code);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ code: "TOTP_CODE_INVALID" });

    expect(emailsTo("third@terhal.co")).toHaveLength(0);
    expect(await auditedActions(auditActions.STEP_UP_FAILED)).toEqual([
      { adminId: admin.id, after: { purpose: "invite_admin", reason: "wrong_code" } },
      { adminId: admin.id, after: { purpose: "invite_admin", reason: "code_reused" } },
    ]);
  });

  it("replaces an earlier link when the same email is invited again", async () => {
    const { agent, secret } = await signedInAdmin();

    await invite(agent, "second@terhal.co", totpCode(secret));
    const first = lastLinkTokenTo("second@terhal.co", "invite");
    await invite(agent, "second@terhal.co", totpCode(secret, 1));

    const lookup = await createAgent().request(`/v1/admin/invitations/lookup?token=${first}`);
    expect(await lookup.json()).toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("revokes the invitation when the email can't be sent", async () => {
    const { agent, secret } = await signedInAdmin();
    sendEmail.mockRejectedValueOnce(new Error("mail server down"));

    const response = await invite(agent, "second@terhal.co", totpCode(secret));
    expect(response.status).toBe(503);
    expect(await prisma.adminInvitation.count({ where: { revokedAt: null } })).toBe(0);
    expect(await auditedActions(auditActions.INVITATION_SENT)).toHaveLength(0);
  });

  it("needs a signed in admin", async () => {
    const response = await invite(createAgent(), "second@terhal.co", "123456");
    expect(response.status).toBe(401);
  });
});

describe("pending invitations", () => {
  it("lists them with who sent them, and revokes one", async () => {
    const { admin, agent, secret } = await signedInAdmin();
    await invite(agent, "second@terhal.co", totpCode(secret));
    const token = lastLinkTokenTo("second@terhal.co", "invite");

    const listed = await agent.request("/v1/admin/invitations");
    expect(listed.status).toBe(200);
    const { data, nextCursor } = (await listed.json()) as {
      data: { id: string; email: string; invitedBy: unknown }[];
      nextCursor: string | null;
    };
    expect(nextCursor).toBeNull();
    expect(data).toEqual([
      expect.objectContaining({
        email: "second@terhal.co",
        invitedBy: { id: admin.id, name: "Test Admin" },
      }),
    ]);
    const id = data[0]?.id ?? "";

    const revoked = await agent.request(`/v1/admin/invitations/${id}`, { method: "DELETE" });
    expect(revoked.status).toBe(204);

    // The link stops working, it's no longer listed, and revoking it again finds nothing.
    const lookup = await createAgent().request(`/v1/admin/invitations/lookup?token=${token}`);
    expect(await lookup.json()).toMatchObject({ code: "INVITATION_INVALID" });
    expect(await (await agent.request("/v1/admin/invitations")).json()).toMatchObject({ data: [] });
    const again = await agent.request(`/v1/admin/invitations/${id}`, { method: "DELETE" });
    expect(again.status).toBe(404);
    expect(await again.json()).toMatchObject({ code: "NOT_FOUND" });

    expect(await auditedActions(auditActions.INVITATION_REVOKED)).toEqual([
      { adminId: admin.id, after: { email: "second@terhal.co", reason: "revoked_by_admin" } },
    ]);
  });

  it("can't revoke an unknown invitation", async () => {
    const { agent } = await signedInAdmin();
    const response = await agent.request("/v1/admin/invitations/nope", { method: "DELETE" });
    expect(response.status).toBe(404);
  });
});
