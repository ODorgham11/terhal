import type { AuditAction } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";

export interface AuditEntry {
  // The admin who did it, or null for the system (the seed) and for sign in attempts on emails that aren't admins.
  adminId: string | null;
  action: AuditAction;
  // What the event is about, e.g. an Admin, AdminSession, or AdminInvitation, and its id.
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

type Client = typeof prisma | Prisma.TransactionClient;

// The log is append-only: a database trigger rejects any update or delete, so nothing here can rewrite history. Pass the
// transaction client when the event is part of a change, so the change and its record are saved together or not at all.
export const recordAudit = async (
  { ipAddress = null, ...entry }: AuditEntry,
  client: Client = prisma,
) => {
  await client.auditLog.create({ data: { ...entry, ipAddress } });
};
