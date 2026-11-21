import type { AuditAction, ListAuditLogs } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";

// One page at a time, newest first unless asked otherwise. Ties are broken by time and then id, so the order is stable
// and the cursor never skips or repeats a log, even while new ones are being written.
export const listLogs = async ({
  limit,
  sort,
  order,
  cursor,
  action,
  adminId,
  system,
  entityType,
  entityId,
  from,
  to,
  q,
}: ListAuditLogs) => {
  const where: Prisma.AuditLogWhereInput = {
    action: action ? { in: action } : undefined,
    adminId: system ? null : adminId,
    entityType,
    entityId,
    createdAt: from || to ? { gte: from, lte: to } : undefined,
    // Every word has to match somewhere, so "ammar sign_in" finds Ammar's sign ins.
    AND: q
      ?.split(/\s+/)
      .filter(Boolean)
      .map((word) => ({
        OR: [
          { action: { contains: word, mode: "insensitive" } },
          { entityType: { contains: word, mode: "insensitive" } },
          { entityId: { contains: word, mode: "insensitive" } },
          { ipAddress: { contains: word, mode: "insensitive" } },
          { admin: { firstName: { contains: word, mode: "insensitive" } } },
          { admin: { lastName: { contains: word, mode: "insensitive" } } },
          { admin: { email: { contains: word, mode: "insensitive" } } },
        ],
      })),
  };

  // One extra row says whether there's another page, without counting the whole table.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [
      ...(sort === "createdAt" ? [] : [{ [sort]: order }]),
      { createdAt: order },
      { id: order },
    ],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      ipAddress: true,
      before: true,
      after: true,
      createdAt: true,
      admin: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  // Prisma models never leave the server: every response is an explicit DTO.
  const data = rows.slice(0, limit).map((log) => ({
    ...log,
    action: log.action as AuditAction,
    createdAt: log.createdAt.toISOString(),
  }));
  return { data, nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null };
};
