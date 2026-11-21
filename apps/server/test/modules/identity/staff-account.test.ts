import { auditActions } from "@terhal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { emailsTo } from "../../support/emails";
import { STAFF_PASSWORD, createStaff } from "../../support/factories";
import { DASHBOARD_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([resetDatabase(), resetRedis()]);
});

const EMAIL = "mona@terhal.co";
const NEW_PASSWORD = "New-password-2";

const signIn = async (email = EMAIL, password = STAFF_PASSWORD) => {
  const agent = createAgent(DASHBOARD_ORIGIN);
  const response = await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email, password },
  });
  return { agent, response };
};

const signedIn = async () => (await signIn()).agent;

describe("editing your account", () => {
  it("changes only what's sent, and emails go out in the chosen language", async () => {
    const staff = await createStaff(EMAIL, ["trips"]);
    const agent = await signedIn();

    const updated = await agent.request("/v1/staff/account", {
      method: "PATCH",
      json: { firstName: "Mona", phone: "0100 123 4567", locale: "en" },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: staff.id,
      firstName: "Mona",
      lastName: "Staff",
      phone: "+201001234567",
      locale: "en",
      email: EMAIL,
      permissions: ["trips"],
    });

    const cleared = await agent.request("/v1/staff/account", {
      method: "PATCH",
      json: { phone: null },
    });
    expect(await cleared.json()).toMatchObject({ firstName: "Mona", phone: null, locale: "en" });

    // Their password reset email is now in English alone.
    await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/auth/password/reset/request", {
      method: "POST",
      json: { email: EMAIL },
    });
    await vi.waitFor(() => {
      expect(emailsTo(EMAIL)).toHaveLength(1);
    });
    const [email] = emailsTo(EMAIL);
    expect(email?.subject).toBe("Reset your Terhal password");
    expect(email?.text).not.toMatch(/[؀-ۿ]/);
  });

  it("refuses invalid values and fields that aren't theirs to change", async () => {
    await createStaff(EMAIL, ["trips"]);
    const agent = await signedIn();

    const response = await agent.request("/v1/staff/account", {
      method: "PATCH",
      json: { firstName: "M", locale: "fr" },
    });
    expect(response.status).toBe(400);

    // Unknown fields are dropped, so permissions and the email can't be changed this way.
    await agent.request("/v1/staff/account", {
      method: "PATCH",
      json: { permissions: ["team"], email: "other@terhal.co" },
    });
    expect(await prisma.staff.findUniqueOrThrow({ where: { email: EMAIL } })).toMatchObject({
      permissions: ["trips"],
    });
  });

  it("needs a signed in staff member", async () => {
    const response = await createAgent(DASHBOARD_ORIGIN).request("/v1/staff/account", {
      method: "PATCH",
      json: { firstName: "Mona" },
    });
    expect(response.status).toBe(401);
  });
});

describe("changing your password", () => {
  it("takes the current password and signs you out everywhere else", async () => {
    const staff = await createStaff(EMAIL);
    const agent = await signedIn();
    const other = await signedIn();

    const wrong = await agent.request("/v1/staff/auth/password", {
      method: "POST",
      json: { currentPassword: "Not-the-password-1", newPassword: NEW_PASSWORD },
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });

    const weak = await agent.request("/v1/staff/auth/password", {
      method: "POST",
      json: { currentPassword: STAFF_PASSWORD, newPassword: "short" },
    });
    expect(weak.status).toBe(400);

    const changed = await agent.request("/v1/staff/auth/password", {
      method: "POST",
      json: { currentPassword: STAFF_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.status).toBe(204);

    expect((await agent.request("/v1/staff/auth/session")).status).toBe(200);
    expect((await other.request("/v1/staff/auth/session")).status).toBe(401);

    expect((await signIn(EMAIL, STAFF_PASSWORD)).response.status).toBe(401);
    expect((await signIn(EMAIL, NEW_PASSWORD)).response.status).toBe(200);

    expect(
      await prisma.auditLog.findMany({
        where: { action: auditActions.STAFF_PASSWORD_CHANGED },
        select: { adminId: true, staffId: true, entityId: true },
      }),
    ).toEqual([{ adminId: null, staffId: staff.id, entityId: staff.id }]);
  });
});

describe("your sessions", () => {
  const sessionsOf = async (agent: ReturnType<typeof createAgent>) =>
    (await (await agent.request("/v1/staff/auth/sessions")).json()) as {
      data: { id: string; current: boolean }[];
      nextCursor: null;
    };

  it("lists them, marking this one, and ends one", async () => {
    await createStaff(EMAIL);
    const laptop = await signedIn();
    const phone = await signedIn();

    const listed = await sessionsOf(laptop);
    expect(listed.data).toHaveLength(2);
    expect(listed.data.filter((session) => session.current)).toHaveLength(1);
    expect(listed.nextCursor).toBeNull();

    const phoneSession = listed.data.find((session) => !session.current);
    if (!phoneSession) throw new Error("Expected the phone's session.");

    const ended = await laptop.request(`/v1/staff/auth/sessions/${phoneSession.id}`, {
      method: "DELETE",
    });
    expect(ended.status).toBe(204);
    expect((await phone.request("/v1/staff/auth/session")).status).toBe(401);
    expect((await laptop.request("/v1/staff/auth/session")).status).toBe(200);

    // Already over, or unknown.
    const again = await laptop.request(`/v1/staff/auth/sessions/${phoneSession.id}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  it("won't end someone else's session", async () => {
    await createStaff(EMAIL);
    await createStaff("karim@terhal.co");
    const mine = await signedIn();
    const theirs = (await signIn("karim@terhal.co")).agent;
    const [theirSession] = (await sessionsOf(theirs)).data;

    const response = await mine.request(`/v1/staff/auth/sessions/${theirSession?.id ?? ""}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
    expect((await theirs.request("/v1/staff/auth/session")).status).toBe(200);
  });

  it("ending this session signs you out", async () => {
    await createStaff(EMAIL);
    const agent = await signedIn();
    const [current] = (await sessionsOf(agent)).data;

    const response = await agent.request(`/v1/staff/auth/sessions/${current?.id ?? ""}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);
    expect(agent.jar.size).toBe(0);
    expect((await agent.request("/v1/staff/auth/session")).status).toBe(401);
  });

  it("signs you out everywhere else", async () => {
    await createStaff(EMAIL);
    const laptop = await signedIn();
    const phone = await signedIn();
    const tablet = await signedIn();

    const response = await laptop.request("/v1/staff/auth/sessions/all/revoke", {
      method: "POST",
    });
    expect(response.status).toBe(204);
    expect((await laptop.request("/v1/staff/auth/session")).status).toBe(200);
    for (const agent of [phone, tablet]) {
      expect((await agent.request("/v1/staff/auth/session")).status).toBe(401);
    }
    expect((await sessionsOf(laptop)).data).toHaveLength(1);
  });
});
