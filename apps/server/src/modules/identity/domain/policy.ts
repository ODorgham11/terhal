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
