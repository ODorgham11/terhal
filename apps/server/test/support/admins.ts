import { prisma } from "../../src/platform/db/prisma";
import { ADMIN_PASSWORD, createAdmin, totpCode } from "./factories";
import { createAgent } from "./http";

// Signs an admin in on a new agent (a device of theirs). The code used to sign in is forgotten afterwards, as if they'd
// signed in a while ago, so the test can ask for the current code again where an action takes one.
export const signIn = async (email: string, secret: string) => {
  const agent = createAgent();
  await agent.request("/v1/admin/auth/sign-in", {
    method: "POST",
    json: { email, password: ADMIN_PASSWORD },
  });
  const verified = await agent.request("/v1/admin/auth/verify", {
    method: "POST",
    json: { code: totpCode(secret) },
  });
  if (verified.status !== 200) throw new Error(`Couldn't sign in as ${email}.`);

  await prisma.admin.update({ where: { email }, data: { totpLastUsedStep: null } });
  return agent;
};

// A new admin, signed in.
export const signedInAdmin = async (email = "admin@terhal.co") => {
  const { admin, secret } = await createAdmin(email);
  return { admin, secret, agent: await signIn(email, secret) };
};
