import type { CustomerSignUp } from "@terhal/contracts";
import type { Customer } from "../../../../generated/prisma/client";
import { hash } from "../../../platform/crypto/passwords";
import { violatedUniqueIndex } from "../../../platform/db/errors";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { MAX_VERIFICATION_ATTEMPTS } from "../domain/verification-codes";
import { toCustomerResponse } from "./customers";
import {
  checkCode,
  deliverVerificationCode,
  newVerificationCode,
  wrongCode,
} from "./verification-codes";

const alreadyExists = () =>
  new AppError({
    code: "ACCOUNT_ALREADY_EXISTS",
    status: 409,
    detail: "An account with this email or phone number already exists. Please sign in instead.",
  });

// Creates an unverified account and emails it a code. The customer has no session until they enter the code.
export const signUp = async ({
  firstName,
  lastName,
  phone,
  email,
  password,
  locale,
}: CustomerSignUp) => {
  const existing = await prisma.customer.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { id: true },
  });
  if (existing) throw alreadyExists();

  const { code, columns } = newVerificationCode();

  // The unique indexes still catch two sign ups racing for the same email or phone.
  const customer = await prisma.customer
    .create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        locale,
        passwordHash: await hash(password),
        status: "UNVERIFIED",
        ...columns,
        verificationMethod: "EMAIL",
      },
    })
    .catch((error: unknown) => {
      throw violatedUniqueIndex(error) ? alreadyExists() : error;
    });

  await deliverVerificationCode(email, code, locale);
  return toCustomerResponse(customer);
};

// Confirms the account with the emailed code and activates it. The caller then starts a session.
export const verifyCustomer = async (email: string, code: string) => {
  const customer = await prisma.customer.findUnique({ where: { email } });

  // An unknown email reads as a wrong code, so this doesn't reveal which emails have accounts.
  if (!customer) throw wrongCode();

  const verificationHash = await checkCode(customer, code, async (hash, now) => {
    const { count } = await prisma.customer.updateMany({
      where: {
        id: customer.id,
        status: "UNVERIFIED",
        verificationHash: hash,
        verificationAttempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        verificationExpiresAt: { gt: now },
      },
      data: { verificationAttempts: { increment: 1 } },
    });
    return count > 0;
  });

  // Matching on the code's hash makes sure it's used once, even by two requests at the same time.
  const { count } = await prisma.customer.updateMany({
    where: { id: customer.id, status: "UNVERIFIED", verificationHash },
    data: {
      status: "ACTIVE",
      verifiedAt: new Date(),
      verifiedVia: "EMAIL",
      verificationHash: null,
      verificationExpiresAt: null,
      verificationAttempts: 0,
    },
  });
  if (count === 0) throw wrongCode();

  return prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
};

// Emails a new code to an unverified customer, replacing the old one. Does nothing for any other email, and the caller
// answers the same either way, so this doesn't reveal which emails have accounts.
export const sendCustomerCode = async (customer: Pick<Customer, "id" | "email" | "locale">) => {
  const { code, columns } = newVerificationCode();
  const { count } = await prisma.customer.updateMany({
    where: { id: customer.id, status: "UNVERIFIED" },
    data: { ...columns, verificationMethod: "EMAIL" },
  });
  if (count > 0) await deliverVerificationCode(customer.email, code, customer.locale);
};

export const resendCustomerCode = async (email: string) => {
  const customer = await prisma.customer.findUnique({
    where: { email },
    select: { id: true, email: true, status: true, locale: true },
  });
  if (customer?.status === "UNVERIFIED") await sendCustomerCode(customer);
};
