import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../../src/platform/db/prisma";
import { resetDatabase } from "../../support/database";
import { emailsTo, lastCodeTo } from "../../support/emails";
import { SITE_ORIGIN, createAgent } from "../../support/http";
import { resetRedis } from "../../support/redis";

// Codes are emailed, so the tests read them from the captured emails instead of sending any.
vi.mock("../../../src/platform/email/email", () => ({ sendEmail: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([resetDatabase(), resetRedis()]);
});

const EMAIL = "karim@example.com";

type Agent = ReturnType<typeof createAgent>;

const start = (agent: Agent) =>
  agent.request("/v1/site/guest", {
    method: "POST",
    json: { firstName: "Karim", lastName: "Fathy", phone: "01112345678", email: EMAIL },
  });

const verify = (agent: Agent, code: string) =>
  agent.request("/v1/site/guest/verify", { method: "POST", json: { code } });

const wrongCodeFor = (code: string) => (code === "000000" ? "111111" : "000000");

describe("guests", () => {
  it("get their emails in the language they started in", async () => {
    const agent = createAgent(SITE_ORIGIN);
    const started = await agent.request("/v1/site/guest", {
      method: "POST",
      json: {
        firstName: "Karim",
        lastName: "Fathy",
        phone: "01112345678",
        email: EMAIL,
        locale: "en",
      },
    });
    expect(await started.json()).toMatchObject({ locale: "en" });

    const [email] = emailsTo(EMAIL);
    expect(email?.subject).toBe("Your Terhal verification code");
    expect(email?.text).not.toMatch(/[\u0600-\u06FF]/);
    expect((await prisma.guestSession.findFirstOrThrow()).locale).toBe("en");
  });

  it("start a session, verify it with the emailed code and see their details", async () => {
    const agent = createAgent(SITE_ORIGIN);

    const started = await start(agent);
    expect(started.status).toBe(201);
    expect(await started.json()).toMatchObject({
      phone: "+201112345678",
      email: EMAIL,
      verified: false,
    });
    expect(agent.jar.has("guest_session")).toBe(true);

    // Only the token's hash is stored.
    const session = await prisma.guestSession.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(agent.jar.get("guest_session"));
    const days = (session.expiresAt.getTime() - session.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    // Not verified yet.
    const unverified = await agent.request("/v1/site/guest");
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toMatchObject({ code: "VERIFICATION_REQUIRED" });

    const verified = await verify(agent, lastCodeTo(EMAIL));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ verified: true });

    const current = await agent.request("/v1/site/guest");
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({
      firstName: "Karim",
      email: EMAIL,
      verified: true,
    });
  });

  it("are refused a wrong or expired code, and a code dies after 5 wrong tries", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await start(agent);
    const code = lastCodeTo(EMAIL);

    expect(await (await verify(agent, wrongCodeFor(code))).json()).toMatchObject({
      code: "VERIFICATION_CODE_INVALID",
    });
    for (let i = 0; i < 4; i++) await verify(agent, wrongCodeFor(code));
    expect(await (await verify(agent, code)).json()).toMatchObject({
      code: "VERIFICATION_CODE_EXPIRED",
    });

    // A new code starts afresh, but not once it has expired.
    expect((await agent.request("/v1/site/guest/verify/resend", { method: "POST" })).status).toBe(
      202,
    );
    expect(emailsTo(EMAIL)).toHaveLength(2);
    await prisma.guestSession.updateMany({
      data: { verificationExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await (await verify(agent, lastCodeTo(EMAIL))).json()).toMatchObject({
      code: "VERIFICATION_CODE_EXPIRED",
    });

    await agent.request("/v1/site/guest/verify/resend", { method: "POST" });
    expect((await verify(agent, lastCodeTo(EMAIL))).status).toBe(200);
  });

  it("need a guest session to verify", async () => {
    const response = await verify(createAgent(SITE_ORIGIN), "123456");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("sign out, ending the session", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await start(agent);
    await verify(agent, lastCodeTo(EMAIL));
    const token = agent.jar.get("guest_session") ?? "";

    expect((await agent.request("/v1/site/guest/sign-out", { method: "POST" })).status).toBe(204);
    expect(agent.jar.has("guest_session")).toBe(false);

    // The old cookie no longer works either.
    const replay = createAgent(SITE_ORIGIN);
    replay.jar.set("guest_session", token);
    expect((await replay.request("/v1/site/guest")).status).toBe(401);
  });

  it("starting again ends the browser's previous guest session", async () => {
    const agent = createAgent(SITE_ORIGIN);
    await start(agent);
    await start(agent);

    expect(await prisma.guestSession.count({ where: { revokedAt: null } })).toBe(1);
  });
});
