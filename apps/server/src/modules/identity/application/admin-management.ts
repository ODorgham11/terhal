import { auditActions } from "@terhal/contracts";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { deactivationRefusal } from "../domain/policy";
import { inactive } from "./admins";
import { revokeAdminSessions } from "./sessions";
import { requireCurrentCode } from "./step-up";

export const adminNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no admin with this id." });

export const cannotTargetSelf = (detail: string) =>
  new AppError({ code: "CANNOT_TARGET_SELF", status: 400, detail });

// Every admin, oldest first. There are only ever a few, so they come in one page.
export const listAdmins = async () => {
  const admins = await prisma.admin.findMany({ orderBy: { createdAt: "asc" } });

  return {
    data: admins.map((admin) => ({
      id: admin.id,
      firstName: admin.firstName,
      lastName: admin.lastName,
      email: admin.email,
      status: admin.status,
      twoFactorEnabled: admin.totpSecret !== null,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
    })),
    nextCursor: null,
  };
};

// Deactivates another admin, confirmed with the acting admin's current code, and signs them out everywhere at once.
// Deactivating an admin who's already inactive changes nothing.
export const deactivateAdmin = async (
  targetId: string,
  code: string,
  actorId: string,
  ipAddress: string | null,
) => {
  const target = await prisma.admin.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw adminNotFound();
  if (targetId === actorId) {
    throw cannotTargetSelf("You can't deactivate your own account. Ask another admin.");
  }

  await requireCurrentCode(actorId, code, "deactivate_admin", ipAddress);

  await prisma.$transaction(async (tx) => {
    // Locks every active admin's row, in one order, until the transaction ends. Two admins deactivating each other at
    // once would otherwise both see the other still active and leave nobody: here the second waits, then sees the first's
    // change (Postgres re-checks the WHERE on rows it waited for) and is refused.
    const active = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Admin" WHERE "status" = 'ACTIVE' ORDER BY "id" FOR UPDATE`;
    const activeIds = active.map(({ id }) => id);

    // Deactivated a moment ago, by an admin they were deactivating at the same time.
    if (!activeIds.includes(actorId)) throw inactive();

    const refusal = deactivationRefusal(actorId, targetId, activeIds);
    if (refusal === "self") {
      throw cannotTargetSelf("You can't deactivate your own account. Ask another admin.");
    }
    if (refusal === "last_active") {
      throw new AppError({
        code: "LAST_ACTIVE_ADMIN",
        status: 409,
        detail: "This is the last active admin, so they can't be deactivated.",
      });
    }

    if (!activeIds.includes(targetId)) return;

    await tx.admin.update({ where: { id: targetId }, data: { status: "INACTIVE" } });

    await revokeAdminSessions(tx, targetId, {
      reason: "account_deactivated",
      actorId,
      ipAddress,
    });

    await recordAudit(
      {
        adminId: actorId,
        action: auditActions.ACCOUNT_DEACTIVATED,
        entityType: "Admin",
        entityId: targetId,
        before: { status: "ACTIVE" },
        after: { status: "INACTIVE" },
        ipAddress,
      },
      tx,
    );
  });
};

// Lets an inactive admin sign in again. Reactivating an active admin changes nothing.
export const reactivateAdmin = async (
  targetId: string,
  actorId: string,
  ipAddress: string | null,
) => {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.admin.updateMany({
      where: { id: targetId, status: "INACTIVE" },
      data: { status: "ACTIVE" },
    });

    if (count === 0) {
      const exists = await tx.admin.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!exists) throw adminNotFound();
      return;
    }

    await recordAudit(
      {
        adminId: actorId,
        action: auditActions.ACCOUNT_REACTIVATED,
        entityType: "Admin",
        entityId: targetId,
        before: { status: "INACTIVE" },
        after: { status: "ACTIVE" },
        ipAddress,
      },
      tx,
    );
  });
};
