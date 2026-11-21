import type { AuditAction } from "@terhal/contracts";
import type { Prisma } from "../../../../generated/prisma/client";
import { prisma } from "../../../platform/db/prisma";

export interface AuditEntry {
  // Who did it: an admin, a staff member, or neither (null or left out) for the system (the seed) and for sign in
  // attempts on emails that aren't admins. Never both (the AuditLog_one_actor check).
  adminId?: string | null;
  staffId?: string | null;
  action: AuditAction;
  // What the event is about, e.g. an Admin, AdminSession, or AdminInvitation, and its id.
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

// Who a change made in the admin panel or the dashboard is recorded against, with where the request came from.
export type AuditActor = (
  { adminId: string; staffId?: never } | { staffId: string; adminId?: never }
) & {
  ipAddress: string | null;
};

type Client = typeof prisma | Prisma.TransactionClient;

// The log is append-only: a database trigger rejects any update or delete, so nothing here can rewrite history. Pass the
// transaction client when the event is part of a change, so the change and its record are saved together or not at all.
export const recordAudit = async (
  { ipAddress = null, ...entry }: AuditEntry,
  client: Client = prisma,
) => {
  await client.auditLog.create({ data: { ...entry, ipAddress } });
};

// Several events in one insert, e.g. every price a bulk upload changed. Same rules as recordAudit.
export const recordAudits = async (entries: AuditEntry[], client: Client = prisma) => {
  if (entries.length === 0) return;
  await client.auditLog.createMany({
    data: entries.map(({ ipAddress = null, ...entry }) => ({ ...entry, ipAddress })),
  });
};
