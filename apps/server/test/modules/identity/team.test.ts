import { auditActions, type StaffPermission } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { signedInAdmin } from "../../support/admins";
import { resetDatabase } from "../../support/database";
import { lastLinkTokenTo } from "../../support/emails";
import { STAFF_PASSWORD, createStaff } from "../../support/factories";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
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

const signIn = async (email: string) => {
  const agent = createAgent(DASHBOARD_ORIGIN);
  const response = await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email, password: STAFF_PASSWORD },
  });
  if (response.status !== 200) throw new Error(`Couldn't sign in as ${email}.`);
  return agent;
};

// A staff member, signed in on a new agent.
const signedInStaff = async (email: string, permissions?: StaffPermission[]) => {
  const staff = await createStaff(email, permissions);
  return { staff, agent: await signIn(email) };
};

const setPermissions = (agent: Agent, id: string, permissions: string[], prefix = "staff/team") =>
  agent.request(`/v1/${prefix}/${id}/permissions`, { method: "PUT", json: { permissions } });
const suspend = (agent: Agent, id: string, prefix = "staff/team") =>
  agent.request(`/v1/${prefix}/${id}/suspend`, { method: "POST" });
const reactivate = (agent: Agent, id: string, prefix = "staff/team") =>
  agent.request(`/v1/${prefix}/${id}/reactivate`, { method: "POST" });
const remove = (agent: Agent, id: string, prefix = "staff/team") =>
  agent.request(`/v1/${prefix}/${id}`, { method: "DELETE" });

const staffRow = (id: string) => prisma.staff.findUniqueOrThrow({ where: { id } });

// Team managers: active staff holding `team`.
const managerCount = () =>
  prisma.staff.count({
    where: { status: "ACTIVE", permissions: { array_contains: ["team"] } },
  });

describe("listing the team", () => {
  it("lists everyone but deleted staff, searches, and shows one", async () => {
    const { staff: me, agent } = await signedInStaff("mona@terhal.co", ["team"]);
    const karim = await createStaff("karim@terhal.co", ["trips"]);
    const gone = await createStaff("gone@terhal.co", ["trips"]);
    await prisma.staff.update({ where: { id: gone.id }, data: { status: "DELETED" } });

    const list = await agent.request("/v1/staff/team");
    expect(list.status).toBe(200);
    const body = (await list.json()) as { data: { id: string }[]; nextCursor: null };
    expect(body.data.map(({ id }) => id)).toEqual([me.id, karim.id]);
    expect(body.data[1]).toMatchObject({
      email: "karim@terhal.co",
      status: "ACTIVE",
      permissions: ["trips"],
      locale: "ar",
      lastLoginAt: null,
    });

    const searched = await agent.request("/v1/staff/team?q=KARIM");
    expect(await searched.json()).toMatchObject({ data: [{ id: karim.id }] });

    const deleted = await agent.request("/v1/staff/team?status=DELETED");
    expect(await deleted.json()).toMatchObject({ data: [{ id: gone.id }] });

    const detail = await agent.request(`/v1/staff/team/${karim.id}`);
    expect(await detail.json()).toMatchObject({ id: karim.id, firstName: "Test" });

    const unknown = await agent.request("/v1/staff/team/nope");
    expect(unknown.status).toBe(404);
  });

  it("needs the team permission", async () => {
    const { agent } = await signedInStaff("mona@terhal.co", ["trips", "customers"]);
    const other = await createStaff("karim@terhal.co", ["trips"]);

    for (const response of [
      await agent.request("/v1/staff/team"),
      await agent.request("/v1/staff/invitations"),
      await suspend(agent, other.id),
      await setPermissions(agent, other.id, ["trips", "team"]),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

describe("changing permissions", () => {
  it("grants any permission, takes effect on the next request, and is audited", async () => {
    const { staff: me, agent } = await signedInStaff("mona@terhal.co", ["team"]);
    const { staff: karim, agent: karimAgent } = await signedInStaff("karim@terhal.co", ["trips"]);

    expect((await karimAgent.request("/v1/staff/team")).status).toBe(403);

    // The manager holds only `team`, and can still grant `pricing`.
    const granted = await setPermissions(agent, karim.id, ["team", "pricing", "team"]);
    expect(granted.status).toBe(204);
    expect((await staffRow(karim.id)).permissions).toEqual(["team", "pricing"]);

    // The same session, no new sign in.
    expect((await karimAgent.request("/v1/staff/team")).status).toBe(200);

    const logs = await prisma.auditLog.findMany({
      where: { action: auditActions.STAFF_PERMISSIONS_CHANGED },
    });
    expect(logs).toMatchObject([
      {
        adminId: null,
        staffId: me.id,
        entityType: "Staff",
        entityId: karim.id,
        before: { permissions: ["trips"] },
        after: { permissions: ["team", "pricing"] },
      },
    ]);

    // Setting the same permissions again records nothing.
    await setPermissions(agent, karim.id, ["pricing", "team"]);
    expect(
      await prisma.auditLog.count({ where: { action: auditActions.STAFF_PERMISSIONS_CHANGED } }),
    ).toBe(1);
  });

  it("refuses an unknown permission", async () => {
    const { agent } = await signedInStaff("mona@terhal.co", ["team"]);
    const karim = await createStaff("karim@terhal.co", ["trips"]);

    const response = await setPermissions(agent, karim.id, ["trips", "everything"]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("guard rails", () => {
  it("refuses changing your own permissions, suspending or deleting yourself", async () => {
    const { staff: me, agent } = await signedInStaff("mona@terhal.co");
    await createStaff("karim@terhal.co", ["team"]);

    for (const response of [
      await setPermissions(agent, me.id, ["trips"]),
      await suspend(agent, me.id),
      await remove(agent, me.id),
    ]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "CANNOT_TARGET_SELF" });
    }
    expect(await staffRow(me.id)).toMatchObject({ status: "ACTIVE" });
    expect((await staffRow(me.id)).permissions).toContain("team");
  });

  it("keeps one active staff member with the team permission", async () => {
    const mona = await createStaff("mona@terhal.co", ["team", "trips"]);
    const { agent: admin } = await signedInAdmin();

    for (const response of [
      await setPermissions(admin, mona.id, ["trips"], "admin/staff"),
      await suspend(admin, mona.id, "admin/staff"),
      await remove(admin, mona.id, "admin/staff"),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "LAST_TEAM_MANAGER" });
    }
    expect(await managerCount()).toBe(1);

    // Once someone else holds it, Mona can lose it.
    const karim = await createStaff("karim@terhal.co", ["trips"]);
    expect((await setPermissions(admin, karim.id, ["team"], "admin/staff")).status).toBe(204);
    expect((await setPermissions(admin, mona.id, ["trips"], "admin/staff")).status).toBe(204);
    expect(await managerCount()).toBe(1);
  });

  it("never leaves nobody with the team permission, even when two managers act on each other at once", async () => {
    const { staff: mona, agent: monaAgent } = await signedInStaff("mona@terhal.co", ["team"]);
    const { staff: karim, agent: karimAgent } = await signedInStaff("karim@terhal.co", ["team"]);

    const responses = await Promise.all([
      suspend(monaAgent, karim.id),
      suspend(karimAgent, mona.id),
    ]);

    // The loser's session was ended (401), or it waited on the winner's lock and found itself suspended (403).
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 401 || status === 403)).toHaveLength(1);
    expect(await managerCount()).toBe(1);
  });

  it("never leaves nobody with the team permission when two managers take it from each other at once", async () => {
    const { staff: mona, agent: monaAgent } = await signedInStaff("mona@terhal.co", ["team"]);
    const { staff: karim, agent: karimAgent } = await signedInStaff("karim@terhal.co", ["team"]);

    const responses = await Promise.all([
      setPermissions(monaAgent, karim.id, ["trips"]),
      setPermissions(karimAgent, mona.id, ["trips"]),
    ]);

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 403)).toHaveLength(1);
    expect(await managerCount()).toBe(1);
  });
});

describe("suspending", () => {
  it("cuts their sessions at once, and reactivating lets them back in", async () => {
    const { staff: me, agent } = await signedInStaff("mona@terhal.co", ["team"]);
    const { staff: karim, agent: karimAgent } = await signedInStaff("karim@terhal.co", ["trips"]);

    expect((await suspend(agent, karim.id)).status).toBe(204);
    expect(await staffRow(karim.id)).toMatchObject({ status: "SUSPENDED" });

    // Their access token is still unexpired, but its session is over.
    expect((await karimAgent.request("/v1/staff/auth/session")).status).toBe(401);
    expect(await prisma.staffSession.count({ where: { staffId: karim.id, revokedAt: null } })).toBe(
      0,
    );
    const signIn = await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/auth/sign-in", {
      method: "POST",
      json: { email: "karim@terhal.co", password: STAFF_PASSWORD },
    });
    expect(await signIn.json()).toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });

    // Suspending again changes nothing.
    expect((await suspend(agent, karim.id)).status).toBe(204);

    expect((await reactivate(agent, karim.id)).status).toBe(204);
    expect(await staffRow(karim.id)).toMatchObject({ status: "ACTIVE", permissions: ["trips"] });
    expect((await reactivate(agent, karim.id)).status).toBe(204);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: karim.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, staffId: true },
    });
    expect(logs).toEqual([
      { action: auditActions.STAFF_SUSPENDED, staffId: me.id },
      { action: auditActions.STAFF_REACTIVATED, staffId: me.id },
    ]);
  });
});

describe("deleting", () => {
  it("ends their sessions, frees their email to be invited again, and is final", async () => {
    const { staff: me, agent } = await signedInStaff("mona@terhal.co", ["team"]);
    const { staff: karim, agent: karimAgent } = await signedInStaff("karim@terhal.co", ["trips"]);

    expect((await remove(agent, karim.id)).status).toBe(204);
    const row = await staffRow(karim.id);
    expect(row.status).toBe("DELETED");
    expect(row.email).not.toBe("karim@terhal.co");
    expect((await karimAgent.request("/v1/staff/auth/session")).status).toBe(401);

    const [log] = await prisma.auditLog.findMany({ where: { action: auditActions.STAFF_DELETED } });
    expect(log).toMatchObject({
      staffId: me.id,
      entityId: karim.id,
      before: { email: "karim@terhal.co", status: "ACTIVE" },
    });

    // Deleting again changes nothing; anything else is refused.
    expect((await remove(agent, karim.id)).status).toBe(204);
    for (const response of [
      await suspend(agent, karim.id),
      await reactivate(agent, karim.id),
      await setPermissions(agent, karim.id, ["trips"]),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "ACCOUNT_DELETED" });
    }

    // The same address can join again, as a new account.
    const invited = await agent.request("/v1/staff/invitations", {
      method: "POST",
      json: { email: "karim@terhal.co", permissions: ["fleet"] },
    });
    expect(invited.status).toBe(201);
    const accepted = await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/invitations/accept", {
      method: "POST",
      json: {
        token: lastLinkTokenTo("karim@terhal.co", "invite"),
        firstName: "Karim",
        lastName: "Again",
        password: STAFF_PASSWORD,
      },
    });
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({
      email: "karim@terhal.co",
      permissions: ["fleet"],
    });
    expect(await prisma.staff.count({ where: { email: "karim@terhal.co" } })).toBe(1);
  });
});

describe("staff invitations", () => {
  const invite = (agent: Agent, email: string) =>
    agent.request("/v1/staff/invitations", {
      method: "POST",
      json: { email, permissions: ["trips"] },
    });

  it("are listed, revoked and resent by the team", async () => {
    const { staff: me, agent } = await signedInStaff("mona@terhal.co", ["team"]);
    await invite(agent, "first@terhal.co");
    await invite(agent, "second@terhal.co");
    const [first, second] = await prisma.staffInvitation.findMany({
      orderBy: { createdAt: "asc" },
    });
    if (!first || !second) throw new Error("Expected two invitations.");

    // Inviting from the dashboard is audited too.
    expect(
      await prisma.auditLog.count({
        where: { action: auditActions.STAFF_INVITED, staffId: me.id },
      }),
    ).toBe(2);

    const list = await agent.request("/v1/staff/invitations");
    expect(await list.json()).toEqual({
      data: [
        expect.objectContaining({
          id: second.id,
          email: "second@terhal.co",
          permissions: ["trips"],
          invitedBy: { id: me.id, name: "Test Staff" },
        }),
        expect.objectContaining({ id: first.id }),
      ],
      nextCursor: null,
    });

    // Revoking stops the link.
    const firstToken = lastLinkTokenTo("first@terhal.co", "invite");
    expect(
      (await agent.request(`/v1/staff/invitations/${first.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    const lookup = await createAgent(DASHBOARD_ORIGIN).request(
      `/v1/staff/invitations/lookup?token=${firstToken}`,
    );
    expect(await lookup.json()).toMatchObject({ code: "INVITATION_INVALID" });
    expect(
      (await agent.request(`/v1/staff/invitations/${first.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (await agent.request(`/v1/staff/invitations/${first.id}/resend`, { method: "POST" })).status,
    ).toBe(404);

    // Resending an expired invitation sends a new link; the old one stops working.
    await prisma.staffInvitation.update({
      where: { id: second.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const oldToken = lastLinkTokenTo("second@terhal.co", "invite");
    const resent = await agent.request(`/v1/staff/invitations/${second.id}/resend`, {
      method: "POST",
    });
    expect(resent.status).toBe(200);
    expect(await resent.json()).toMatchObject({ email: "second@terhal.co" });
    const newToken = lastLinkTokenTo("second@terhal.co", "invite");
    expect(newToken).not.toBe(oldToken);

    const staff = createAgent(DASHBOARD_ORIGIN);
    expect(
      await (await staff.request(`/v1/staff/invitations/lookup?token=${oldToken}`)).json(),
    ).toMatchObject({ code: "INVITATION_INVALID" });
    expect((await staff.request(`/v1/staff/invitations/lookup?token=${newToken}`)).status).toBe(
      200,
    );

    const logs = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [auditActions.STAFF_INVITATION_REVOKED, auditActions.STAFF_INVITATION_RESENT],
        },
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, staffId: true, entityId: true },
    });
    expect(logs).toEqual([
      { action: auditActions.STAFF_INVITATION_REVOKED, staffId: me.id, entityId: first.id },
      { action: auditActions.STAFF_INVITATION_RESENT, staffId: me.id, entityId: second.id },
    ]);
  });

  it("says so when the resent email couldn't be sent", async () => {
    const { agent } = await signedInStaff("mona@terhal.co", ["team"]);
    await invite(agent, "first@terhal.co");
    const invitation = await prisma.staffInvitation.findFirstOrThrow();

    sendEmail.mockRejectedValueOnce(new Error("Resend is down"));
    const response = await agent.request(`/v1/staff/invitations/${invitation.id}/resend`, {
      method: "POST",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("managing staff from the admin panel", () => {
  it("lists, changes, suspends and deletes staff, audited under the admin", async () => {
    const { admin, agent } = await signedInAdmin();
    const mona = await createStaff("mona@terhal.co", ["team"]);
    const karim = await createStaff("karim@terhal.co", ["trips"]);

    const list = await agent.request("/v1/admin/staff?q=terhal");
    expect(await list.json()).toMatchObject({ data: [{ id: mona.id }, { id: karim.id }] });
    expect(await (await agent.request(`/v1/admin/staff/${karim.id}`)).json()).toMatchObject({
      id: karim.id,
    });
    expect((await agent.request("/v1/admin/staff/nope")).status).toBe(404);

    expect((await setPermissions(agent, karim.id, ["fleet"], "admin/staff")).status).toBe(204);
    expect((await suspend(agent, karim.id, "admin/staff")).status).toBe(204);
    expect((await reactivate(agent, karim.id, "admin/staff")).status).toBe(204);
    expect((await remove(agent, karim.id, "admin/staff")).status).toBe(204);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: karim.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, adminId: true, staffId: true },
    });
    expect(logs).toEqual(
      [
        auditActions.STAFF_PERMISSIONS_CHANGED,
        auditActions.STAFF_SUSPENDED,
        auditActions.STAFF_REACTIVATED,
        auditActions.STAFF_DELETED,
      ].map((action) => ({ action, adminId: admin.id, staffId: null })),
    );
  });

  it("lists, revokes and resends staff invitations", async () => {
    const { admin, agent } = await signedInAdmin();
    await agent.request("/v1/admin/staff/invitations", {
      method: "POST",
      json: { email: "first@terhal.co" },
    });
    const invitation = await prisma.staffInvitation.findFirstOrThrow();

    const list = await agent.request("/v1/admin/staff/invitations");
    expect(await list.json()).toMatchObject({
      data: [{ id: invitation.id, invitedBy: null }],
      nextCursor: null,
    });

    const resent = await agent.request(`/v1/admin/staff/invitations/${invitation.id}/resend`, {
      method: "POST",
    });
    expect(resent.status).toBe(200);
    const revoked = await agent.request(`/v1/admin/staff/invitations/${invitation.id}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);
    expect(await (await agent.request("/v1/admin/staff/invitations")).json()).toEqual({
      data: [],
      nextCursor: null,
    });

    expect(
      await prisma.auditLog.count({
        where: {
          adminId: admin.id,
          action: {
            in: [auditActions.STAFF_INVITATION_RESENT, auditActions.STAFF_INVITATION_REVOKED],
          },
        },
      }),
    ).toBe(2);
  });

  it("can't be used from the dashboard", async () => {
    const { agent } = await signedInStaff("mona@terhal.co", ["team"]);
    expect((await agent.request("/v1/admin/staff")).status).toBe(401);
  });
});
