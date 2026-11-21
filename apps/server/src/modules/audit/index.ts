// The append-only record of what admins, staff (outside trips) and the system did, and the admin panel's view of it.
export { recordAudit, recordAudits, type AuditActor, type AuditEntry } from "./application/record";
export { auditRoutes } from "./http/routes";
