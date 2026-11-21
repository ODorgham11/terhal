import type { Admin as AdminResponse } from "@terhal/contracts";
import type { Admin } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";

// Prisma models never leave the server: every response is an explicit DTO, so new columns (and secrets like
// passwordHash) are never exposed by accident.
export const toAdminResponse = (admin: Admin): AdminResponse => ({
  id: admin.id,
  firstName: admin.firstName,
  lastName: admin.lastName,
  email: admin.email,
  status: admin.status,
});

// The signed in admin. requireAdmin has already checked they exist and are active.
export const currentAdmin = async (adminId: string) => {
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) {
    throw new AppError({
      code: "UNAUTHENTICATED",
      status: 401,
      detail: "You must be signed in to access this resource.",
    });
  }
  return toAdminResponse(admin);
};

export const inactive = () =>
  new AppError({
    code: "ACCOUNT_NOT_ACTIVE",
    status: 403,
    detail: "This admin account is not active.",
  });
