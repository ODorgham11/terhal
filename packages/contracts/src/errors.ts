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

  // Invitations
  "ACCOUNT_ALREADY_EXISTS",
  "INVITATION_INVALID",
  "INVITATION_EXPIRED",

  // Two-factor
  "TOTP_SETUP_REQUIRED",
  "TOTP_CODE_INVALID",
  "TOTP_CHALLENGE_INVALID",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
