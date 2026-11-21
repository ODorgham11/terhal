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

  // Fleet and offices
  // Archiving a driver, a vehicle or an office while it's on a live trip (pending, confirmed or in progress).
  "HAS_UPCOMING_TRIPS",
  // Another driver has this phone, another vehicle this plate, another office this name.
  "DRIVER_PHONE_TAKEN",
  "PLATE_NUMBER_TAKEN",
  "OFFICE_NAME_TAKEN",
  // Only an external driver or vehicle can come through an office.
  "OFFICE_REQUIRES_EXTERNAL",
  // The office named in the request doesn't exist or is archived.
  "OFFICE_NOT_AVAILABLE",
  // The location named in the request doesn't exist or is deleted.
  "LOCATION_NOT_AVAILABLE",
  // A vehicle image that isn't a JPEG, PNG or WebP (judged from its bytes, not its name).
  "IMAGE_TYPE_NOT_ALLOWED",
  // A vehicle already has the most images it can have.
  "IMAGE_LIMIT_REACHED",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
