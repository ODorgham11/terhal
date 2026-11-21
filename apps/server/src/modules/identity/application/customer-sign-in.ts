import { compare, compareAgainstNothing } from "../../../platform/crypto/passwords";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { sendCustomerCode } from "./customer-sign-up";
import { customerInactive, verificationRequired } from "./customers";

const wrongCredentials = () =>
  new AppError({
    code: "INVALID_CREDENTIALS",
    status: 401,
    detail: "The email, phone number or password is incorrect.",
  });

// Checks the password of the customer with this email or phone number (already normalized by the contract). The caller
// then starts a session.
export const signInCustomer = async (identifier: string, password: string) => {
  const customer = await prisma.customer.findUnique({
    where: identifier.includes("@") ? { email: identifier } : { phone: identifier },
  });

  // Use the same error for both cases, taking as long, so the response doesn't reveal which accounts exist.
  if (!customer) {
    await compareAgainstNothing(password);
    throw wrongCredentials();
  }
  if (!(await compare(password, customer.passwordHash))) throw wrongCredentials();

  // Checked after the password, so only someone who knows it learns the account's state.
  if (customer.status === "SUSPENDED" || customer.status === "DELETED") throw customerInactive();

  // They may have lost the first code or let it expire, so send a fresh one to finish with.
  if (customer.status === "UNVERIFIED") {
    await sendCustomerCode(customer.id, customer.email);
    throw verificationRequired();
  }

  return customer;
};
