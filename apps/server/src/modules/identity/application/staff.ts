import { StaffPermission, type Staff as StaffResponse } from "@terhal/contracts";
import type { Staff } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";

// Permissions are stored as JSON. Ones this version doesn't know (one since removed, say) are dropped, like
// requireStaff does, so the dashboard never shows a permission the API won't honour.
export const permissionsOf = (stored: unknown): StaffPermission[] =>
  Array.isArray(stored)
    ? stored.filter((value): value is StaffPermission => StaffPermission.safeParse(value).success)
    : [];

// Prisma models never leave the server: every response is an explicit DTO, so new columns (and secrets like
// passwordHash) are never exposed by accident.
export const toStaffResponse = (staff: Staff): StaffResponse => ({
  id: staff.id,
  firstName: staff.firstName,
  lastName: staff.lastName,
  email: staff.email,
  phone: staff.phone,
  status: staff.status,
  permissions: permissionsOf(staff.permissions),
  locale: staff.locale,
});

// The signed in staff member. requireStaff has already checked they exist and are active.
export const currentStaffMember = async (staffId: string) => {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new AppError({
      code: "UNAUTHENTICATED",
      status: 401,
      detail: "You must be signed in to access this resource.",
    });
  }
  return toStaffResponse(staff);
};

export const staffInactive = () =>
  new AppError({
    code: "ACCOUNT_NOT_ACTIVE",
    status: 403,
    detail: "This staff account is not active.",
  });
