import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { emailsTo, lastCodeTo, lastResetTokenTo } from "../../support/emails";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

// Codes and links are emailed, so the tests read them from the captured emails instead of sending any.
vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([resetDatabase(), resetRedis()]);
});

const EMAIL = "mona@example.com";
const PHONE = "+201001234567";
const PASSWORD = "Correct-horse-1";

type Agent = ReturnType<typeof createAgent>;

const signUp = (agent: Agent, overrides: Record<string, string> = {}) =>
  agent.request("/v1/site/auth/sign-up", {
    method: "POST",
    json: {
      firstName: "Mona",
      lastName: "Adel",
      phone: "0100 123 4567",
      email: "Mona@Example.com",
      password: PASSWORD,
      ...overrides,
    },
  });

const verify = (agent: Agent, code: string, email = EMAIL) =>
  agent.request("/v1/site/auth/verify", { method: "POST", json: { email, code } });

const signIn = (agent: Agent, identifier: string, password = PASSWORD) =>
  agent.request("/v1/site/auth/sign-in", { method: "POST", json: { identifier, password } });

// A code that isn't the one sent, whatever that was.
const wrongCodeFor = (code: string) => (code === "000000" ? "111111" : "000000");

// Signs up and verifies, leaving the agent signed in.
const verifiedCustomer = async () => {
  const agent = createAgent(SITE_ORIGIN);
  await signUp(agent);
  await verify(agent, lastCodeTo(EMAIL));
  return agent;
};

describe("signing up", () => {
  it("creates an unverified account, then verifying it signs the customer in", async () => {
    const agent = createAgent(SITE_ORIGIN);

    const created = await signUp(agent);
    expect(created.status).toBe(201);
    // Normalized: the email lowercased, the local phone number in international format.
    expect(await created.json()).toMatchObject({
      email: EMAIL,
      phone: PHONE,
      status: "UNVERIFIED",
    });
    // No session until the code is entered.
    expect((await agent.request("/v1/site/auth/session")).status).toBe(401);

    // The email is in Arabic, then English.
    const [email] = emailsTo(EMAIL);
    expect(email?.text.indexOf("رمز التحقق")).toBeLessThan(
      email?.text.indexOf("verification code") ?? 0,
    );

    const verified = await verify(agent, lastCodeTo(EMAIL));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ email: EMAIL, status: "ACTIVE" });

    const session = await agent.request("/v1/site/auth/session");
    expect(await session.json()).toMatchObject({ email: EMAIL, status: "ACTIVE" });

    const customer = await prisma.customer.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(customer).toMatchObject({ verifiedVia: "EMAIL", verificationHash: null });
    expect(customer.verifiedAt).not.toBeNull();
  });

  it("refuses an email or a phone number that's already taken", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);

    const sameEmail = await signUp(agent, { phone: "+201009999999" });
    expect(sameEmail.status).toBe(409);
    expect(await sameEmail.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });

    // Written differently, but the same phone number.
    const samePhone = await signUp(agent, {
      email: "other@example.com",
      phone: "+20 100 123 4567",
    });
    expect(samePhone.status).toBe(409);
    expect(await samePhone.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });

    expect(await prisma.customer.count()).toBe(1);
  });

  it("only takes calls from the customer site", async () => {
    const response = await signUp(createAgent());
    expect(await response.json()).toMatchObject({ code: "UNTRUSTED_ORIGIN" });
  });
});

describe("verification codes", () => {
  it("rejects a wrong code, and the right one still works after", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);
    const code = lastCodeTo(EMAIL);

    const wrong = await verify(agent, wrongCodeFor(code));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });

    expect((await verify(agent, code)).status).toBe(200);
    // Used up.
    expect(await (await verify(agent, code)).json()).toMatchObject({
      code: "VERIFICATION_CODE_INVALID",
    });
  });

  it("gives an unknown email the same answer as a wrong code", async () => {
    const response = await verify(createAgent(SITE_ORIGIN), "123456", "nobody@example.com");
    expect(await response.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });
  });

  it("refuses an expired code", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);
    await prisma.customer.update({
      where: { email: EMAIL },
      data: { verificationExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await (await verify(agent, lastCodeTo(EMAIL))).json()).toMatchObject({
      code: "VERIFICATION_CODE_EXPIRED",
    });
  });

  it("kills a code after 5 wrong tries, even the right one", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);
    const code = lastCodeTo(EMAIL);

    for (let i = 0; i < 5; i++) {
      expect(await (await verify(agent, wrongCodeFor(code))).json()).toMatchObject({
        code: "VERIFICATION_CODE_INVALID",
      });
    }
    expect(await (await verify(agent, code)).json()).toMatchObject({
      code: "VERIFICATION_CODE_EXPIRED",
    });
  });

  it("emails a new code that replaces the old one", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);
    const first = lastCodeTo(EMAIL);
    // Use up some tries on the first code; a new one starts afresh.
    for (let i = 0; i < 4; i++) await verify(agent, wrongCodeFor(first));

    const resent = await agent.request("/v1/site/auth/verify/resend", {
      method: "POST",
      json: { email: EMAIL },
    });
    expect(resent.status).toBe(202);
    expect(emailsTo(EMAIL)).toHaveLength(2);

    const second = lastCodeTo(EMAIL);
    if (first !== second) {
      expect(await (await verify(agent, first)).json()).toMatchObject({
        code: "VERIFICATION_CODE_INVALID",
      });
    }
    expect((await verify(agent, second)).status).toBe(200);
  });

  it("answers a resend the same for an email without an unverified account", async () => {
    const agent = createAgent(SITE_ORIGIN);
    const response = await agent.request("/v1/site/auth/verify/resend", {
      method: "POST",
      json: { email: "nobody@example.com" },
    });
    expect(response.status).toBe(202);
    expect(emailsTo("nobody@example.com")).toHaveLength(0);
  });

  it("limits how often a code can be resent", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await agent.request("/v1/site/auth/verify/resend", {
        method: "POST",
        json: { email: EMAIL },
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });
});

describe("signing in", () => {
  it("takes an email or a phone number, written either way", async () => {
    await verifiedCustomer();

    for (const identifier of ["MONA@example.com", PHONE, "01001234567", "0100-123-4567"]) {
      const agent = createAgent(SITE_ORIGIN);
      const response = await signIn(agent, identifier);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ email: EMAIL });
      expect((await agent.request("/v1/site/auth/session")).status).toBe(200);
    }
  });

  it("gives the same answer for an unknown account and a wrong password", async () => {
    await verifiedCustomer();

    for (const [identifier, password] of [
      [EMAIL, "Wrong-password-1"],
      ["nobody@example.com", PASSWORD],
      ["01009999999", PASSWORD],
    ] as const) {
      const response = await signIn(createAgent(SITE_ORIGIN), identifier, password);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
  });

  it("sends an unverified customer a fresh code instead of a session", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await signUp(agent);

    const response = await signIn(agent, EMAIL);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "VERIFICATION_REQUIRED" });
    expect((await agent.request("/v1/site/auth/session")).status).toBe(401);
    expect(emailsTo(EMAIL)).toHaveLength(2);

    expect((await verify(agent, lastCodeTo(EMAIL))).status).toBe(200);
  });

  it("refuses a suspended customer", async () => {
    await verifiedCustomer();
    await prisma.customer.update({ where: { email: EMAIL }, data: { status: "SUSPENDED" } });

    const response = await signIn(createAgent(SITE_ORIGIN), EMAIL);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
  });

  it("limits guesses at one account", async () => {
    await verifiedCustomer();

    const statuses: number[] = [];
    // The same account, written differently, shares one limit.
    for (const identifier of [
      "01001234567",
      PHONE,
      "0100 123 4567",
      "00201001234567",
      PHONE,
      PHONE,
    ]) {
      statuses.push(
        (await signIn(createAgent(SITE_ORIGIN), identifier, "Wrong-password-1")).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});

describe("sessions", () => {
  it("refreshes, rotating the refresh token, and signs out", async () => {
    const agent = await verifiedCustomer();

    const oldRefresh = agent.jar.get("customer_refresh");
    expect(oldRefresh).toBeDefined();
    expect((await agent.request("/v1/site/auth/refresh", { method: "POST" })).status).toBe(204);
    expect(agent.jar.get("customer_refresh")).not.toBe(oldRefresh);

    // The old refresh token no longer works.
    const replay = createAgent(SITE_ORIGIN);
    replay.jar.set("customer_refresh", oldRefresh ?? "");
    expect(
      await (await replay.request("/v1/site/auth/refresh", { method: "POST" })).json(),
    ).toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });

    expect((await agent.request("/v1/site/auth/sign-out", { method: "POST" })).status).toBe(204);
    expect((await agent.request("/v1/site/auth/session")).status).toBe(401);
    expect(await prisma.customerSession.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("stops refreshing a customer who was suspended", async () => {
    const agent = await verifiedCustomer();
    await prisma.customer.update({ where: { email: EMAIL }, data: { status: "SUSPENDED" } });

    expect(
      await (await agent.request("/v1/site/auth/refresh", { method: "POST" })).json(),
    ).toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });
    expect(agent.jar.has("customer_refresh")).toBe(false);
  });
});

describe("resetting a password", () => {
  const requestReset = (agent: Agent, email = EMAIL) =>
    agent.request("/v1/site/auth/password-reset/request", { method: "POST", json: { email } });

  const completeReset = (agent: Agent, token: string, password = "New-password-2") =>
    agent.request("/v1/site/auth/password-reset/complete", {
      method: "POST",
      json: { token, password },
    });

  it("sets the new password, signs out everywhere and works only once", async () => {
    const signedIn = await verifiedCustomer();
    const agent = createAgent(SITE_ORIGIN);

    expect((await requestReset(agent)).status).toBe(202);
    const token = lastResetTokenTo(EMAIL);
    expect(emailsTo(EMAIL).at(-1)?.text).toContain(`${SITE_ORIGIN}/reset-password?token=`);

    expect((await completeReset(agent, token)).status).toBe(204);
    expect(await prisma.customerSession.count({ where: { revokedAt: null } })).toBe(0);
    expect(
      await (await signedIn.request("/v1/site/auth/refresh", { method: "POST" })).json(),
    ).toMatchObject({ code: "INVALID_REFRESH_TOKEN" });

    expect((await signIn(createAgent(SITE_ORIGIN), EMAIL, PASSWORD)).status).toBe(401);
    expect((await signIn(createAgent(SITE_ORIGIN), EMAIL, "New-password-2")).status).toBe(200);

    expect(await (await completeReset(agent, token, "Another-password-3")).json()).toMatchObject({
      code: "PASSWORD_RESET_INVALID",
    });
  });

  it("refuses an expired link", async () => {
    await verifiedCustomer();
    const agent = createAgent(SITE_ORIGIN);
    await requestReset(agent);
    await prisma.customer.update({
      where: { email: EMAIL },
      data: { passwordResetExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await (await completeReset(agent, lastResetTokenTo(EMAIL))).json()).toMatchObject({
      code: "PASSWORD_RESET_EXPIRED",
    });
  });

  it("only honours the newest link", async () => {
    await verifiedCustomer();
    const agent = createAgent(SITE_ORIGIN);
    await requestReset(agent);
    const first = lastResetTokenTo(EMAIL);
    await requestReset(agent);

    expect(await (await completeReset(agent, first)).json()).toMatchObject({
      code: "PASSWORD_RESET_INVALID",
    });
    expect((await completeReset(agent, lastResetTokenTo(EMAIL))).status).toBe(204);
  });

  it("answers the same for an email without an account", async () => {
    const response = await requestReset(createAgent(SITE_ORIGIN), "nobody@example.com");
    expect(response.status).toBe(202);
    expect(emailsTo("nobody@example.com")).toHaveLength(0);
  });
});
