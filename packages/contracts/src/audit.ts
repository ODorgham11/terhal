import { z } from "zod";

// Every recorded event. Kept in one place so the log stays searchable by a fixed set of names.
export const auditActions = {
  INVITATION_SENT: "admin.invitation.sent",
  INVITATION_REVOKED: "admin.invitation.revoked",
  INVITATION_TOTP_ISSUED: "admin.invitation.totp_issued",
  INVITATION_ACCEPT_FAILED: "admin.invitation.accept_failed",
  INVITATION_ACCEPTED: "admin.invitation.accepted",
  TOTP_ENABLED: "admin.totp.enabled",
  SIGN_IN_PASSWORD_FAILED: "admin.sign_in.password_failed",
  SIGN_IN_PASSWORD_PASSED: "admin.sign_in.password_passed",
  SIGN_IN_TOTP_FAILED: "admin.sign_in.totp_failed",
  SIGN_IN_BLOCKED: "admin.sign_in.blocked",
  SIGN_IN_SUCCEEDED: "admin.sign_in.succeeded",
  SESSION_REVOKED: "admin.session.revoked",
  SIGN_OUT: "admin.sign_out",
} as const;

export type AuditAction = (typeof auditActions)[keyof typeof auditActions];

const actions = Object.values(auditActions) as [AuditAction, ...AuditAction[]];

// A query parameter sent once arrives as a string and sent several times as an array, so accept both.
const many = <T extends z.ZodType>(schema: T, error: string) =>
  z
    .union([schema, z.array(schema)], { error })
    .transform((value) => (Array.isArray(value) ? value : [value]) as z.output<T>[]);

const Id = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must contain 100 characters at most.`);

export const ListAuditLogs = z
  .object({
    limit: z.coerce
      .number({ error: "Limit must be a number." })
      .int("Limit must be a whole number.")
      .min(1, "Limit must be at least 1.")
      .max(100, "Limit must be 100 at most.")
      .default(50),
    // Only columns that are never empty, so paging a sort never skips or repeats a log.
    sort: z
      .enum(["createdAt", "action", "entityType"], {
        error: "Sort must be createdAt, action or entityType.",
      })
      .default("createdAt"),
    order: z.enum(["asc", "desc"], { error: "Order must be asc or desc." }).default("desc"),
    // The id of the last log on the current page. The next page starts right after it.
    cursor: Id("Cursor").optional(),
    action: many(z.enum(actions), "Unknown action.").optional(),
    adminId: Id("Admin").optional(),
    // Only the events with no admin behind them: the seed, or a failed sign in for an email that isn't an admin.
    system: z
      .enum(["true", "false"], { error: "System must be true or false." })
      .transform((value) => value === "true")
      .optional(),
    entityType: Id("Entity type").optional(),
    entityId: Id("Entity").optional(),
    from: z.iso
      .datetime({ offset: true, error: "From must be a date and time." })
      .transform((value) => new Date(value))
      .optional(),
    to: z.iso
      .datetime({ offset: true, error: "To must be a date and time." })
      .transform((value) => new Date(value))
      .optional(),
    q: z.string().trim().max(100, "Search must contain 100 characters at most.").optional(),
  })
  .refine((query) => !(query.adminId && query.system), {
    message: "Filter by an admin or by system events, not both.",
    path: ["system"],
  })
  .refine((query) => !(query.from && query.to) || query.from <= query.to, {
    message: "From must be before to.",
    path: ["from"],
  });

export type ListAuditLogs = z.output<typeof ListAuditLogs>;

const Json = z.unknown();

export const AuditLog = z
  .object({
    id: z.string(),
    action: z.enum(actions),
    entityType: z.string(),
    entityId: z.string(),
    ipAddress: z.string().nullable(),
    before: Json.nullable(),
    after: Json.nullable(),
    createdAt: z.iso.datetime(),
    admin: z
      .object({ id: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() })
      .nullable()
      .meta({ description: "Null for the system and for sign in attempts on unknown emails." }),
  })
  .meta({ id: "AuditLog" });
