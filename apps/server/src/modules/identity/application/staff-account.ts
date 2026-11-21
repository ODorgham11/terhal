import { auditActions, type ChangePassword, type UpdateStaffAccount } from "@terhal/contracts";
import { compare, hash } from "../../../platform/crypto/passwords";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { toStaffResponse } from "./staff";
import { revokeAllStaffSessions } from "./staff-sessions";

// A signed in staff member managing their own account. Their email and permissions aren't theirs to change: the team
// manages those.

// Changes only the fields sent; a null phone removes it.
export const updateStaffAccount = async (staffId: string, changes: UpdateStaffAccount) =>
  toStaffResponse(await prisma.staff.update({ where: { id: staffId }, data: changes }));

// Takes the current password, so a session left open on a shared computer can't lock its owner out. Signs them out
// everywhere else; this session stays.
export const changeStaffPassword = async (
  { currentPassword, newPassword }: ChangePassword,
  { staffId, sessionId }: { staffId: string; sessionId: string },
  ipAddress: string | null,
) => {
  const staff = await prisma.staff.findUniqueOrThrow({
    where: { id: staffId },
    select: { passwordHash: true },
  });

  if (!(await compare(currentPassword, staff.passwordHash))) {
    throw new AppError({
      code: "INVALID_CREDENTIALS",
      status: 401,
      detail: "Your current password is incorrect.",
    });
  }

  const passwordHash = await hash(newPassword);

  await prisma.$transaction(async (tx) => {
    // A reset link asked for earlier would undo this, so it stops working too.
    await tx.staff.update({
      where: { id: staffId },
      data: { passwordHash, passwordResetHash: null, passwordResetExpiresAt: null },
    });
    await revokeAllStaffSessions(staffId, tx, sessionId);
    await recordAudit(
      {
        adminId: null,
        staffId,
        action: auditActions.STAFF_PASSWORD_CHANGED,
        entityType: "Staff",
        entityId: staffId,
        ipAddress,
      },
      tx,
    );
  });
};
