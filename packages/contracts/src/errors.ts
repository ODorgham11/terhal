// Every code an error response can carry. Clients switch on these, never on the message, so never rename one.
export const errorCodes = [
  // Generic
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "FORBIDDEN",
  "PAYLOAD_TOO_LARGE",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "RATE_LIMITED",
  "UNTRUSTED_ORIGIN",

  // Auth
  "UNAUTHENTICATED",
  "ACCESS_TOKEN_EXPIRED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_NOT_ACTIVE",
  "INVALID_REFRESH_TOKEN",
  // A customer or a guest who hasn't confirmed the code sent to them yet.
  "VERIFICATION_REQUIRED",

  // Invitations
  "ACCOUNT_ALREADY_EXISTS",
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",

  // Password resets
  "PASSWORD_RESET_INVALID",
  "PASSWORD_RESET_EXPIRED",

  // Verification codes sent to customers and guests
  "VERIFICATION_CODE_INVALID",
  "VERIFICATION_CODE_EXPIRED",

  // Two-factor
  "TOTP_SETUP_REQUIRED",
  "TOTP_CODE_INVALID",
  "TOTP_CHALLENGE_INVALID",
  // A two-factor reset link, emailed when another admin resets an admin's authenticator.
  "TWO_FACTOR_RESET_INVALID",
  "TWO_FACTOR_RESET_EXPIRED",

  // Managing admins
  // An admin acting on their own account where only another admin may (deactivating, resetting two-factor).
  "CANNOT_TARGET_SELF",
  // Deactivating the only active admin would leave nobody able to sign in to the admin panel.
  "LAST_ACTIVE_ADMIN",
  // The admin being acted on isn't active. Not ACCOUNT_NOT_ACTIVE, which means the signed in account itself.
  "ADMIN_NOT_ACTIVE",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
