import { auditActions } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";
import { AppError } from "../../../platform/errors/app-error";
import { recordAudit } from "../../audit/index";
import { revokeCustomerSessions } from "./customer-sessions";

// Admins suspending and reactivating customers, from the admin panel only (staff only view customers). A reason is
// required and kept in the audit log.

interface StatusChange {
  customerId: string;
  reason: string;
  adminId: string;
  ipAddress: string | null;
}

const customerNotFound = () =>
  new AppError({ code: "NOT_FOUND", status: 404, detail: "There's no customer with this id." });

const deleted = () =>
  new AppError({ code: "ACCOUNT_DELETED", status: 409, detail: "This customer was deleted." });

// Locks the customer's row, so a suspension and a reactivation at the same time apply one after the other.
const lockCustomer = async (tx: Prisma.TransactionClient, customerId: string) => {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
  if (!row) throw customerNotFound();
  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    select: { status: true, verifiedAt: true },
  });
  if (customer.status === "DELETED") throw deleted();
  return customer;
};

// Ends their sessions at once and blocks signing in (and so booking) until reactivated. Their upcoming trips stay as
// they are: staff decide what happens to them. Suspending a suspended customer changes nothing.
export const suspendCustomer = ({ customerId, reason, adminId, ipAddress }: StatusChange) =>
  prisma.$transaction(async (tx) => {
    const { status } = await lockCustomer(tx, customerId);
    if (status === "SUSPENDED") return;

    // A reset link asked for earlier would otherwise still let them choose a password.
    await tx.customer.update({
      where: { id: customerId },
      data: { status: "SUSPENDED", passwordResetHash: null, passwordResetExpiresAt: null },
    });
    await revokeCustomerSessions(customerId, tx);
    await recordAudit(
      {
        adminId,
        action: auditActions.CUSTOMER_SUSPENDED,
        entityType: "Customer",
        entityId: customerId,
        before: { status },
        after: { status: "SUSPENDED", reason },
        ipAddress,
      },
      tx,
    );
  });

// Lets a suspended customer back in: active again, or unverified if they never confirmed their account. Reactivating a
// customer who isn't suspended changes nothing.
export const reactivateCustomer = ({ customerId, reason, adminId, ipAddress }: StatusChange) =>
  prisma.$transaction(async (tx) => {
    const { status, verifiedAt } = await lockCustomer(tx, customerId);
    if (status !== "SUSPENDED") return;

    const restored = verifiedAt ? "ACTIVE" : "UNVERIFIED";
    await tx.customer.update({ where: { id: customerId }, data: { status: restored } });
    await recordAudit(
      {
        adminId,
        action: auditActions.CUSTOMER_REACTIVATED,
        entityType: "Customer",
        entityId: customerId,
        before: { status },
        after: { status: restored, reason },
        ipAddress,
      },
      tx,
    );
  });
