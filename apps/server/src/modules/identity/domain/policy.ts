// Admin and staff account rules. Pure: no database, Redis or HTTP, so they can be tested on their own.

// Shorter than staff invitations, since an admin account has more power.
export const INVITATION_LIFETIME_MS = 48 * 60 * 60 * 1000;

export const MAX_ACTIVE_SESSIONS = 3;

// A refresh keeps a session going for another 7 days, but it ends 12 hours after signing in no matter how often it's
// refreshed, so a stolen session can't live on.
export const SESSION_SLIDING_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;

// When a session that started at `createdAt` expires if it's refreshed (or created) at `now`.
export const sessionExpiry = (now: Date, createdAt: Date) =>
  new Date(
    Math.min(
      now.getTime() + SESSION_SLIDING_LIFETIME_MS,
      createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS,
    ),
  );

// The sessions to revoke, oldest first, so a new one fits under the limit.
export const sessionsToRevoke = <T>(activeOldestFirst: T[]) =>
  activeOldestFirst.slice(0, Math.max(0, activeOldestFirst.length - MAX_ACTIVE_SESSIONS + 1));

// Short, since anyone who can read the inbox can use the link. Completing it also takes the admin's authenticator code.
export const ADMIN_PASSWORD_RESET_LIFETIME_MS = 15 * 60 * 1000;

// As long as an invitation: setting up a new authenticator after a reset works the same way as accepting one.
export const TWO_FACTOR_RESET_LIFETIME_MS = INVITATION_LIFETIME_MS;

export type DeactivationRefusal = "self" | "last_active";

// Why `actorId` can't deactivate `targetId`, or null when they can. `activeAdminIds` is every active admin at the time.
// An admin can't deactivate themselves (another admin has to), and the last active admin can't be deactivated, or
// nobody could sign in to the admin panel again.
export const deactivationRefusal = (
  actorId: string,
  targetId: string,
  activeAdminIds: readonly string[],
): DeactivationRefusal | null => {
  if (actorId === targetId) return "self";
  if (activeAdminIds.includes(targetId) && activeAdminIds.every((id) => id === targetId)) {
    return "last_active";
  }
  return null;
};

// Staff sign in to the dashboard every working day, so their sessions last longer than an admin's: a refresh keeps one
// going for another 7 days, up to 30 days after signing in, on up to 5 devices at once.

export const STAFF_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// Short, since anyone who can read the inbox can use the link.
export const STAFF_PASSWORD_RESET_LIFETIME_MS = 60 * 60 * 1000;

export const STAFF_MAX_ACTIVE_SESSIONS = 5;

export const STAFF_SESSION_SLIDING_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const STAFF_SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

// When a staff session that started at `createdAt` expires if it's refreshed (or created) at `now`.
export const staffSessionExpiry = (now: Date, createdAt: Date) =>
  new Date(
    Math.min(
      now.getTime() + STAFF_SESSION_SLIDING_LIFETIME_MS,
      createdAt.getTime() + STAFF_SESSION_ABSOLUTE_LIFETIME_MS,
    ),
  );

// The staff sessions to revoke, oldest first, so a new one fits under the limit.
export const staffSessionsToRevoke = <T>(activeOldestFirst: T[]) =>
  activeOldestFirst.slice(0, Math.max(0, activeOldestFirst.length - STAFF_MAX_ACTIVE_SESSIONS + 1));

// Managing the team. Nobody changes their own permissions, suspends or deletes themselves: someone else has to. And at
// least one active staff member must keep the team permission, or nobody in the dashboard could manage the team again.

export type TeamChangeRefusal = "self" | "last_team_manager";

// Why `actorId` (a staff member, or null for an admin) can't make this change to `targetId`, or null when they can.
// `managerIds` is every active staff member holding `team` at the time; `targetStillManages` says whether the target is
// one of them after the change.
export const teamChangeRefusal = (
  actorId: string | null,
  targetId: string,
  managerIds: readonly string[],
  targetStillManages: boolean,
): TeamChangeRefusal | null => {
  if (actorId === targetId) return "self";
  const losesManager = managerIds.includes(targetId) && !targetStillManages;
  if (losesManager && managerIds.every((id) => id === targetId)) return "last_team_manager";
  return null;
};

// A deleted staff member's email is replaced by this, so the address is free to be invited again. The .invalid domain
// can never receive mail.
export const deletedStaffEmail = (staffId: string) => `deleted-${staffId}@deleted.invalid`;

// Customer account rules. Customers stay signed in much longer than admins: a refresh keeps a session going for another
// 30 days, up to 180 days after signing in, and they can be signed in on more devices at once.
export const MAX_ACTIVE_CUSTOMER_SESSIONS = 10;
export const CUSTOMER_SESSION_SLIDING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const CUSTOMER_SESSION_ABSOLUTE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

export const customerSessionExpiry = (now: Date, createdAt: Date) =>
  new Date(
    Math.min(
      now.getTime() + CUSTOMER_SESSION_SLIDING_LIFETIME_MS,
      createdAt.getTime() + CUSTOMER_SESSION_ABSOLUTE_LIFETIME_MS,
    ),
  );

export const customerSessionsToRevoke = <T>(activeOldestFirst: T[]) =>
  activeOldestFirst.slice(
    0,
    Math.max(0, activeOldestFirst.length - MAX_ACTIVE_CUSTOMER_SESSIONS + 1),
  );

// How long a customer's password reset link works.
export const CUSTOMER_PASSWORD_RESET_LIFETIME_MS = 60 * 60 * 1000;

// A guest session lasts long enough to follow a booking through to the trip. It never slides.
export const GUEST_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
