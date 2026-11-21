import type { Customer as CustomerResponse } from "@terhal/contracts";
import type { Customer } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";

// Prisma models never leave the server: every response is an explicit DTO, so new columns (and secrets like
// passwordHash or the verification hash) are never exposed by accident.
export const toCustomerResponse = (customer: Customer): CustomerResponse => ({
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  phone: customer.phone,
  email: customer.email,
  status: customer.status,
});

// The signed in customer. requireCustomer has already checked they exist and are active.
export const currentCustomer = async (customerId: string) => {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new AppError({
      code: "UNAUTHENTICATED",
      status: 401,
      detail: "You must be signed in to access this resource.",
    });
  }
  return toCustomerResponse(customer);
};

export const customerInactive = () =>
  new AppError({
    code: "ACCOUNT_NOT_ACTIVE",
    status: 403,
    detail: "This account is not active.",
  });

export const verificationRequired = () =>
  new AppError({
    code: "VERIFICATION_REQUIRED",
    status: 403,
    detail: "Please verify your account with the code we sent to your email.",
  });
