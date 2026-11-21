// Invites the first admin by email. Run with `pnpm --filter @terhal/server db:seed`.
// No names or passwords live in the environment: the admin gets a single-use link and sets up their own account.
// Only works while no admin exists. Every admin after the first is invited by an admin.
import { Email } from "@terhal/contracts";
import { inviteFirstAdmin } from "../src/modules/identity/index";
import { prisma } from "../src/platform/db/prisma";
import { AppError } from "../src/platform/errors/app-error";

const main = async () => {
  const value = process.env.ADMIN_EMAIL?.trim();
  if (!value) throw new Error("ADMIN_EMAIL isn't set. Set it to the first admin's email.");

  const result = Email.safeParse(value);
  if (!result.success) {
    throw new Error(`ADMIN_EMAIL: ${result.error.issues[0]?.message ?? "invalid"}`);
  }

  try {
    const { email, expiresAt } = await inviteFirstAdmin(result.data);
    console.log(`Invitation sent to ${email}, valid until ${expiresAt.toUTCString()}.`);
  } catch (error) {
    // Not a failure: the platform is already set up.
    if (error instanceof AppError && error.code === "ACCOUNT_ALREADY_EXISTS") {
      console.log(`${error.message} Skipping.`);
      return;
    }
    throw error;
  }
};

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
