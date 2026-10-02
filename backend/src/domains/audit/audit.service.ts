import { prisma } from "../../shared/utils/prisma.js";
import type { Prisma } from "../../../generated/prisma/client.js";

// Every admin event that's recorded. Kept in one place so the log stays searchable by a fixed set of names.
export const AUDIT_ACTIONS = {
    INVITATION_SENT: "admin.invitation.sent",
    INVITATION_ACCEPTED: "admin.invitation.accepted",
    TOTP_ENABLED: "admin.totp.enabled",
    SIGN_IN_PASSWORD_FAILED: "admin.sign_in.password_failed",
    SIGN_IN_TOTP_FAILED: "admin.sign_in.totp_failed",
    SIGN_IN_BLOCKED: "admin.sign_in.blocked",
    SIGN_IN_SUCCEEDED: "admin.sign_in.succeeded",
    SESSION_REVOKED: "admin.session.revoked",
    SIGN_OUT: "admin.sign_out",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

type AuditEntry = {
    // The admin who did it, or null for the system (the seed) and for sign in attempts on emails that aren't admins.
    adminId: string | null;
    action: AuditAction;
    // What the event is about, e.g. an Admin, AdminSession, or AdminInvitation, and its id.
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
    ipAddress?: string | null;
};

type Client = typeof prisma | Prisma.TransactionClient;

export default class AuditService {
    // Pass the transaction client when the event is part of a change, so the change and its record are saved together
    // or not at all.
    static record = async ({ ipAddress = null, ...entry }: AuditEntry, client: Client = prisma) => {
        await client.auditLog.create({ data: { ...entry, ipAddress } });
    }
}
