import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { emailsTo, lastCodeTo } from "../../support/emails";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([resetDatabase(), resetRedis()]);
});

const EMAIL = "mona@example.com";
const NEW_EMAIL = "mona.new@example.com";
const PASSWORD = "Correct-horse-1";
const NEW_PASSWORD = "New-password-2";

type Agent = ReturnType<typeof createAgent>;

const signIn = async (identifier = EMAIL, password = PASSWORD) => {
  const agent = createAgent(SITE_ORIGIN);
  const response = await agent.request("/v1/site/auth/sign-in", {
    method: "POST",
    json: { identifier, password },
  });
  return { agent, response };
};

// Signs up, verifies and stays signed in.
const verifiedCustomer = async (email = EMAIL, phone = "01001234567", locale = "ar") => {
  const agent = createAgent(SITE_ORIGIN);
  await agent.request("/v1/site/auth/sign-up", {
    method: "POST",
    json: { firstName: "Mona", lastName: "Adel", phone, email, password: PASSWORD, locale },
  });
  await agent.request("/v1/site/auth/verify", {
    method: "POST",
    json: { email, code: lastCodeTo(email) },
  });
  return agent;
};

const post = (agent: Agent, path: string, json?: unknown) =>
  agent.request(`/v1/site/account${path}`, { method: "POST", json });

describe("your details", () => {
  it("shows them and changes only what's sent", async () => {
    const agent = await verifiedCustomer();

    const shown = await agent.request("/v1/site/account");
    expect(await shown.json()).toMatchObject({ email: EMAIL, firstName: "Mona", locale: "ar" });

    const updated = await agent.request("/v1/site/account", {
      method: "PATCH",
      json: { lastName: "Fathy", locale: "en", email: "ignored@example.com" },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      firstName: "Mona",
      lastName: "Fathy",
      locale: "en",
      email: EMAIL,
    });

    const invalid = await agent.request("/v1/site/account", {
      method: "PATCH",
      json: { firstName: "" },
    });
    expect(invalid.status).toBe(400);
  });

  it("needs a signed in customer", async () => {
    expect((await createAgent(SITE_ORIGIN).request("/v1/site/account")).status).toBe(401);
  });
});

describe("changing your email", () => {
  it("only takes effect once the code sent to the new address is confirmed", async () => {
    const agent = await verifiedCustomer();

    const requested = await post(agent, "/email", {
      email: "Mona.New@Example.com",
      password: PASSWORD,
    });
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({ sentTo: NEW_EMAIL });

    // The code went to the new address, in the customer's language.
    const [email] = emailsTo(NEW_EMAIL);
    expect(email?.subject).toBe("رمز التحقق من ترحال");

    // Nothing changed yet.
    expect(await (await agent.request("/v1/site/account")).json()).toMatchObject({ email: EMAIL });
    expect((await signIn(NEW_EMAIL)).response.status).toBe(401);

    const code = lastCodeTo(NEW_EMAIL);
    const wrong = await post(agent, "/email/confirm", {
      code: code === "000000" ? "111111" : "000000",
    });
    expect(await wrong.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });

    const confirmed = await post(agent, "/email/confirm", { code });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ email: NEW_EMAIL });

    expect((await signIn(NEW_EMAIL)).response.status).toBe(200);
    expect((await signIn(EMAIL)).response.status).toBe(401);

    // The code is used up.
    const reused = await post(agent, "/email/confirm", { code });
    expect(await reused.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });
    expect(await prisma.customer.findUniqueOrThrow({ where: { email: NEW_EMAIL } })).toMatchObject({
      pendingEmail: null,
      verificationHash: null,
    });
  });

  it("takes the current password, and refuses an email that's yours or taken", async () => {
    const agent = await verifiedCustomer();
    await verifiedCustomer("karim@example.com", "01112345678");

    const wrongPassword = await post(agent, "/email", {
      email: NEW_EMAIL,
      password: "Wrong-pass-1",
    });
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });

    const same = await post(agent, "/email", { email: EMAIL, password: PASSWORD });
    expect(same.status).toBe(400);
    expect(await same.json()).toMatchObject({ code: "BAD_REQUEST" });

    const taken = await post(agent, "/email", { email: "karim@example.com", password: PASSWORD });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });

    expect(emailsTo(NEW_EMAIL)).toHaveLength(0);
  });

  it("refuses the confirmation when someone else took the email meanwhile", async () => {
    const agent = await verifiedCustomer();
    await post(agent, "/email", { email: NEW_EMAIL, password: PASSWORD });
    const code = lastCodeTo(NEW_EMAIL);

    await verifiedCustomer(NEW_EMAIL, "01112345678");

    const confirmed = await post(agent, "/email/confirm", { code });
    expect(confirmed.status).toBe(409);
    expect(await confirmed.json()).toMatchObject({ code: "ACCOUNT_ALREADY_EXISTS" });
    expect(await (await agent.request("/v1/site/account")).json()).toMatchObject({ email: EMAIL });
  });

  it("reads a confirmation with nothing waiting as a wrong code", async () => {
    const agent = await verifiedCustomer();
    const response = await post(agent, "/email/confirm", { code: "123456" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });
  });
});

describe("changing your phone", () => {
  it("emails the code to your current address and changes it once confirmed", async () => {
    const agent = await verifiedCustomer();

    const requested = await post(agent, "/phone", { phone: "01112345678", password: PASSWORD });
    expect(requested.status).toBe(202);
    expect(await requested.json()).toMatchObject({ sentTo: EMAIL });
    expect(await (await agent.request("/v1/site/account")).json()).toMatchObject({
      phone: "+201001234567",
    });

    const confirmed = await post(agent, "/phone/confirm", { code: lastCodeTo(EMAIL) });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ phone: "+201112345678" });
    expect((await signIn("01112345678")).response.status).toBe(200);
  });

  it("replaces a pending email change, so its code no longer works", async () => {
    const agent = await verifiedCustomer();
    await post(agent, "/email", { email: NEW_EMAIL, password: PASSWORD });
    const emailCode = lastCodeTo(NEW_EMAIL);
    await post(agent, "/phone", { phone: "01112345678", password: PASSWORD });

    const response = await post(agent, "/email/confirm", { code: emailCode });
    expect(await response.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });

    // The phone's code can't confirm an email change either.
    const crossed = await post(agent, "/email/confirm", { code: lastCodeTo(EMAIL) });
    expect(await crossed.json()).toMatchObject({ code: "VERIFICATION_CODE_INVALID" });
    expect((await post(agent, "/phone/confirm", { code: lastCodeTo(EMAIL) })).status).toBe(200);
  });
});

describe("changing your password", () => {
  it("takes the current password and signs you out everywhere else", async () => {
    const agent = await verifiedCustomer();
    const { agent: other } = await signIn();

    const wrong = await post(agent, "/password", {
      currentPassword: "Wrong-pass-1",
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.status).toBe(401);

    const changed = await post(agent, "/password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(204);
    expect((await agent.request("/v1/site/account")).status).toBe(200);
    expect((await other.request("/v1/site/account")).status).toBe(401);

    expect((await signIn(EMAIL, PASSWORD)).response.status).toBe(401);
    expect((await signIn(EMAIL, NEW_PASSWORD)).response.status).toBe(200);
  });
});

describe("your sessions", () => {
  const sessionsOf = async (agent: Agent) =>
    (await (await agent.request("/v1/site/account/sessions")).json()) as {
      data: { id: string; current: boolean }[];
    };

  it("lists them and ends one, but not someone else's", async () => {
    const laptop = await verifiedCustomer();
    const { agent: phone } = await signIn();
    const stranger = await verifiedCustomer("karim@example.com", "01112345678");

    const { data } = await sessionsOf(laptop);
    expect(data).toHaveLength(2);
    const phoneSession = data.find((session) => !session.current);
    if (!phoneSession) throw new Error("Expected the phone's session.");

    expect(
      (await stranger.request(`/v1/site/account/sessions/${phoneSession.id}`, { method: "DELETE" }))
        .status,
    ).toBe(404);
    expect(
      (await laptop.request(`/v1/site/account/sessions/${phoneSession.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await phone.request("/v1/site/account")).status).toBe(401);
    expect((await laptop.request("/v1/site/account")).status).toBe(200);
  });

  it("ends this one, signing you out", async () => {
    const agent = await verifiedCustomer();
    const [current] = (await sessionsOf(agent)).data;

    const response = await agent.request(`/v1/site/account/sessions/${current?.id ?? ""}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(204);
    expect((await agent.request("/v1/site/account")).status).toBe(401);
  });

  it("signs you out everywhere else", async () => {
    const laptop = await verifiedCustomer();
    const { agent: phone } = await signIn();
    const { agent: tablet } = await signIn();

    expect((await post(laptop, "/sessions/all/revoke")).status).toBe(204);
    expect((await laptop.request("/v1/site/account")).status).toBe(200);
    for (const agent of [phone, tablet]) {
      expect((await agent.request("/v1/site/account")).status).toBe(401);
    }
  });
});
