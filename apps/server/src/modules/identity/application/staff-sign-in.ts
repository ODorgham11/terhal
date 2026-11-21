import { compare, compareAgainstNothing } from "../../../platform/crypto/passwords";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { staffInactive } from "./staff";

const wrongCredentials = () =>
  new AppError({
    code: "INVALID_CREDENTIALS",
    status: 401,
    detail: "The email or password is incorrect.",
  });

// Checks a staff member's email and password. The caller then starts a session.
export const signInStaff = async (email: string, password: string) => {
  const staff = await prisma.staff.findUnique({ where: { email } });

  // The same error, after as much work, for both cases, so the response doesn't reveal which accounts exist.
  if (!staff) {
    await compareAgainstNothing(password);
    throw wrongCredentials();
  }

  if (!(await compare(password, staff.passwordHash))) throw wrongCredentials();

  // Checked after the password, so only someone who knows it learns the account is suspended.
  if (staff.status !== "ACTIVE") throw staffInactive();

  return prisma.staff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
};
