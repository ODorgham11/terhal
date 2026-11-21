import {
  auditActions,
  type ListTeam,
  type StaffPermission,
  type TeamMember,
} from "@terhal/contracts";
import type { Prisma, Staff } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { deletedStaffEmail, teamChangeRefusal } from "../domain/policy";
import { permissionsOf, staffInactive, toStaffResponse } from "./staff";
import { revokeAllStaffSessions } from "./staff-sessions";

// Managing the company's staff: by a staff member with the team permission from the dashboard, or by an admin from the
// admin panel (for support, and to recover a team that locked itself out). Every change is audited under whoever made
// it, and takes effect on the target's next request, since requireStaff reloads their status and permissions each time.

export type TeamActor = { staffId: string } | { adminId: string };

export interface TeamContext {
  actor: TeamActor;
  ipAddress: string | null;
}

const actorStaffId = (actor: TeamActor) => ("staffId" in actor ? actor.staffId : null);

const auditActor = (actor: TeamActor) =>
  "staffId" in actor ? { adminId: null, staffId: actor.staffId } : { adminId: actor.adminId };

export const staffNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no staff member with this id." });

const cannotTargetSelf = (detail: string) =>
  new AppError({ code: "CANNOT_TARGET_SELF", status: 400, detail });

const deleted = () =>
  new AppError({
    code: "ACCOUNT_DELETED",
    status: 409,
    detail: "This staff member was deleted.",
  });

const forbidden = () =>
  new AppError({ code: "FORBIDDEN", status: 403, detail: "You don't have permission to do this." });

export const toTeamMember = (staff: Staff): TeamMember => ({
  ...toStaffResponse(staff),
  lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
  createdAt: staff.createdAt.toISOString(),
});

// Everyone on the team, oldest first. A company has a few dozen staff at most, so they come in one page. Deleted staff
// only show when asked for.
export const listTeam = async ({ q, status }: ListTeam) => {
  const staff = await prisma.staff.findMany({
    where: {
      status: status ?? { not: "DELETED" },
      AND: q
        ?.split(/\s+/)
        .filter(Boolean)
        .map((word) => ({
          OR: [
            { firstName: { contains: word, mode: "insensitive" as const } },
            { lastName: { contains: word, mode: "insensitive" as const } },
            { email: { contains: word, mode: "insensitive" as const } },
          ],
        })),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return { data: staff.map(toTeamMember), nextCursor: null };
};

export const getTeamMember = async (staffId: string) => {
  const staff = await prisma.staff.findUnique({ where: { id: staffId } });
  if (!staff) throw staffNotFound();
  return toTeamMember(staff);
};

interface Change {
  // Whether the target still holds `team`, and is active, once the change is made.
  stillManages: (target: Staff) => boolean;
  // Makes the change, and records it. Returns early when there's nothing to change, so nothing is recorded.
  apply: (tx: Prisma.TransactionClient, target: Staff) => Promise<void>;
  selfRefusal: string;
}

// Runs a change to another staff member under the team's guard rails. Every active staff member holding `team` is
// locked, in one order, until the transaction ends: two managers taking `team` from each other (or suspending each other)
// at once would otherwise both see the other still holding it and leave nobody. Here the second waits, then sees the
// first's change (Postgres re-checks the WHERE on rows it waited for) and is refused.
const changeTeamMember = async (targetId: string, { actor }: TeamContext, change: Change) => {
  const actorId = actorStaffId(actor);
  if (actorId === targetId) throw cannotTargetSelf(change.selfRefusal);

  await prisma.$transaction(async (tx) => {
    const managers = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Staff"
      WHERE "status" = 'ACTIVE' AND "permissions" @> '["team"]'::jsonb
      ORDER BY "id" FOR UPDATE`;
    const managerIds = managers.map(({ id }) => id);

    // Suspended, or lost `team`, a moment ago, by someone acting at the same time.
    if (actorId && !managerIds.includes(actorId)) {
      const self = await tx.staff.findUnique({ where: { id: actorId }, select: { status: true } });
      throw self?.status === "ACTIVE" ? forbidden() : staffInactive();
    }

    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Staff" WHERE "id" = ${targetId} FOR UPDATE`;
    if (!locked) throw staffNotFound();
    const target = await tx.staff.findUniqueOrThrow({ where: { id: targetId } });
    if (target.status === "DELETED") throw deleted();

    const refusal = teamChangeRefusal(actorId, targetId, managerIds, change.stillManages(target));
    if (refusal === "self") throw cannotTargetSelf(change.selfRefusal);
    if (refusal === "last_team_manager") {
      throw new AppError({
        code: "LAST_TEAM_MANAGER",
        status: 409,
        detail:
          "This is the last active staff member with the team permission. Give it to someone else first.",
      });
    }

    await change.apply(tx, target);
  });
};

// Replaces a staff member's permissions. Anyone with `team` can grant any permission.
export const setStaffPermissions = (
  targetId: string,
  permissions: StaffPermission[],
  context: TeamContext,
) =>
  changeTeamMember(targetId, context, {
    selfRefusal: "You can't change your own permissions. Ask a colleague with the team permission.",
    stillManages: (target) => target.status === "ACTIVE" && permissions.includes("team"),
    apply: async (tx, target) => {
      const before = permissionsOf(target.permissions);
      if (before.length === permissions.length && before.every((p) => permissions.includes(p))) {
        return;
      }

      await tx.staff.update({ where: { id: target.id }, data: { permissions } });
      await recordAudit(
        {
          ...auditActor(context.actor),
          action: auditActions.STAFF_PERMISSIONS_CHANGED,
          entityType: "Staff",
          entityId: target.id,
          before: { permissions: before },
          after: { permissions },
          ipAddress: context.ipAddress,
        },
        tx,
      );
    },
  });

// Signs them out everywhere at once and keeps them out until reactivated. Suspending someone already suspended changes
// nothing.
export const suspendStaff = (targetId: string, context: TeamContext) =>
  changeTeamMember(targetId, context, {
    selfRefusal: "You can't suspend yourself. Ask a colleague with the team permission.",
    stillManages: () => false,
    apply: async (tx, target) => {
      if (target.status !== "ACTIVE") return;

      // A reset link asked for earlier would otherwise still work.
      await tx.staff.update({
        where: { id: target.id },
        data: { status: "SUSPENDED", passwordResetHash: null, passwordResetExpiresAt: null },
      });
      await revokeAllStaffSessions(target.id, tx);
      await recordAudit(
        {
          ...auditActor(context.actor),
          action: auditActions.STAFF_SUSPENDED,
          entityType: "Staff",
          entityId: target.id,
          before: { status: "ACTIVE" },
          after: { status: "SUSPENDED" },
          ipAddress: context.ipAddress,
        },
        tx,
      );
    },
  });

// Lets a suspended staff member sign in again, with the permissions they had. Reactivating someone active changes
// nothing.
export const reactivateStaff = (targetId: string, context: TeamContext) =>
  changeTeamMember(targetId, context, {
    selfRefusal: "You can't reactivate yourself.",
    stillManages: (target) => permissionsOf(target.permissions).includes("team"),
    apply: async (tx, target) => {
      if (target.status !== "SUSPENDED") return;

      await tx.staff.update({ where: { id: target.id }, data: { status: "ACTIVE" } });
      await recordAudit(
        {
          ...auditActor(context.actor),
          action: auditActions.STAFF_REACTIVATED,
          entityType: "Staff",
          entityId: target.id,
          before: { status: "SUSPENDED" },
          after: { status: "ACTIVE" },
          ipAddress: context.ipAddress,
        },
        tx,
      );
    },
  });

// Deleting is final, but soft: the row stays for the trips and events that point at it. Their sessions end, and their
// email is replaced by a placeholder so the address can be invited again; the audit entry keeps the real one.
export const deleteStaff = async (targetId: string, context: TeamContext) => {
  try {
    await changeTeamMember(targetId, context, {
      selfRefusal: "You can't delete yourself. Ask a colleague with the team permission.",
      stillManages: () => false,
      apply: async (tx, target) => {
        await tx.staff.update({
          where: { id: target.id },
          data: {
            status: "DELETED",
            email: deletedStaffEmail(target.id),
            passwordResetHash: null,
            passwordResetExpiresAt: null,
          },
        });
        await revokeAllStaffSessions(target.id, tx);
        await recordAudit(
          {
            ...auditActor(context.actor),
            action: auditActions.STAFF_DELETED,
            entityType: "Staff",
            entityId: target.id,
            before: { status: target.status, email: target.email },
            after: { status: "DELETED" },
            ipAddress: context.ipAddress,
          },
          tx,
        );
      },
    });
  } catch (error) {
    // Deleting someone already deleted changes nothing.
    if (error instanceof AppError && error.code === "ACCOUNT_DELETED") return;
    throw error;
  }
};
