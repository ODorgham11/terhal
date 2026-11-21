import type { ChangePassword, UpdateCustomerAccount } from "@terhal/contracts";
import { compare, hash } from "../../../platform/crypto/passwords";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { MAX_VERIFICATION_ATTEMPTS } from "../domain/verification-codes";
import { toCustomerResponse } from "./customers";
import { revokeCustomerSessions } from "./customer-sessions";
import {
  checkCode,
  deliverVerificationCode,
  newVerificationCode,
  wrongCode,
} from "./verification-codes";

// A signed in customer managing their own account. requireCustomer has already checked they're active.

const wrongPassword = () =>
  new AppError({
    code: "INVALID_CREDENTIALS",
    status: 401,
    detail: "Your current password is incorrect.",
  });

const taken = (what: "email" | "phone") =>
  new AppError({
    code: "ACCOUNT_ALREADY_EXISTS",
    status: 409,
    detail: `Another account already uses this ${what === "email" ? "email" : "phone number"}.`,
  });

const unchanged = (what: "email" | "phone") =>
  new AppError({
    code: "BAD_REQUEST",
    status: 400,
    detail: `That's already your ${what === "email" ? "email" : "phone number"}.`,
  });

const checkPassword = async (customerId: string, password: string) => {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  if (!(await compare(password, customer.passwordHash))) throw wrongPassword();
  return customer;
};

// Changes only the fields sent.
export const updateCustomerAccount = async (customerId: string, changes: UpdateCustomerAccount) =>
  toCustomerResponse(await prisma.customer.update({ where: { id: customerId }, data: changes }));

// Starts changing the email or the phone. The new value waits, with a fresh code, until the customer confirms it: the
// code goes to the new email (proving they own it), or for a phone, to their current email (there's no SMS yet). Asking
// again replaces the earlier request, whichever it was, so only the newest code works.
export const requestContactChange = async (
  customerId: string,
  change: { email: string; password: string } | { phone: string; password: string },
) => {
  const customer = await checkPassword(customerId, change.password);
  const what = "email" in change ? "email" : "phone";
  const value = "email" in change ? change.email : change.phone;

  if (customer[what] === value) throw unchanged(what);
  const owner = await prisma.customer.findFirst({
    where: { [what]: value, id: { not: customerId } },
    select: { id: true },
  });
  if (owner) throw taken(what);

  const { code, columns } = newVerificationCode();
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      ...columns,
      verificationMethod: "EMAIL",
      pendingEmail: what === "email" ? value : null,
      pendingPhone: what === "phone" ? value : null,
    },
  });

  const sentTo = what === "email" ? value : customer.email;
  await deliverVerificationCode(sentTo, code, customer.locale);
  return { sentTo, expiresAt: columns.verificationExpiresAt.toISOString() };
};

// Confirms a pending email or phone change with its code, and only then makes it the account's. A password reset link
// sent to the old email stops working.
export const confirmContactChange = async (
  customerId: string,
  what: "email" | "phone",
  code: string,
) => {
  const pendingField = what === "email" ? "pendingEmail" : "pendingPhone";
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const pending = customer[pendingField];

  // Nothing waiting (or a change of the other kind) reads as a wrong code, like a code that was never sent.
  if (!pending) throw wrongCode();

  const verificationHash = await checkCode(customer, code, async (hash, now) => {
    const { count } = await prisma.customer.updateMany({
      where: {
        id: customerId,
        [pendingField]: pending,
        verificationHash: hash,
        verificationAttempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        verificationExpiresAt: { gt: now },
      },
      data: { verificationAttempts: { increment: 1 } },
    });
    return count > 0;
  });

  try {
    // Matching on the code's hash makes sure it's used once, even by two requests at the same time.
    const { count } = await prisma.customer.updateMany({
      where: { id: customerId, [pendingField]: pending, verificationHash },
      data: {
        [what]: pending,
        pendingEmail: null,
        pendingPhone: null,
        verificationHash: null,
        verificationExpiresAt: null,
        verificationAttempts: 0,
        ...(what === "email" && { passwordResetHash: null, passwordResetExpiresAt: null }),
      },
    });
    if (count === 0) throw wrongCode();
  } catch (error) {
    // Someone else took it between the request and the confirmation.
    if (violatedUniqueIndex(error)) throw taken(what);
    throw error;
  }

  return toCustomerResponse(await prisma.customer.findUniqueOrThrow({ where: { id: customerId } }));
};

// Takes the current password, and signs the customer out everywhere else; this session stays.
export const changeCustomerPassword = async (
  { currentPassword, newPassword }: ChangePassword,
  { customerId, sessionId }: { customerId: string; sessionId: string },
) => {
  await checkPassword(customerId, currentPassword);
  const passwordHash = await hash(newPassword);

  await prisma.$transaction(async (tx) => {
    // A reset link asked for earlier would undo this, so it stops working too.
    await tx.customer.update({
      where: { id: customerId },
      data: { passwordHash, passwordResetHash: null, passwordResetExpiresAt: null },
    });
    await revokeCustomerSessions(customerId, tx, sessionId);
  });
};
