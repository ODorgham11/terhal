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
  // Acting on your own account where only someone else may: an admin deactivating themselves or resetting their own
  // two-factor, a staff member changing their own permissions, suspending or deleting themselves.
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

  // Managing staff and customers
  // The change would leave no active staff member with the team permission, so nobody in the dashboard could manage the
  // team again.
  "LAST_TEAM_MANAGER",
  // The staff member or customer being acted on was deleted, which is final.
  "ACCOUNT_DELETED",

  // Locations
  // A live location in the same parent already has this name, in English or in Arabic.
  "LOCATION_NAME_TAKEN",
  // The parent doesn't exist, is deleted, or isn't broader (a district goes in a governorate, an area in either).
  "LOCATION_PARENT_INVALID",
  // The location is deleted: restore it before changing it.
  "LOCATION_DELETED",
  // Only a deleted location that was deleted itself (not along with an ancestor) can be restored, and only while its
  // parent is live.
  "LOCATION_NOT_RESTORABLE",
  // A delete's expectedCount isn't the size of the live subtree any more. `count` has the current size.
  "LOCATION_COUNT_MISMATCH",
  // Governorates come from the seed: they can only be renamed, never created, moved or deleted.
  "GOVERNORATE_READ_ONLY",
  // A pin isn't inside any place the platform serves. `end` says which one (pickup or dropoff), `leg` which trip.
  "OUT_OF_COVERAGE",

  // Trip classes
  // An active class already has this name, in English or in Arabic. Archived classes don't count.
  "TRIP_CLASS_NAME_TAKEN",

  // Pricing
  // The route already has a price for this class and car body: change that one instead.
  "PRICING_EXISTS",

  // Quotes
  // The pickup and the drop-off resolve to the same place, so the trip isn't bookable. `leg` says which trip.
  "QUOTE_SAME_PLACE",

  // Booking
  // The pickup time breaks the booking rules: `reason` is TOO_SOON (under 3 hours ahead), TOO_FAR (over 90 days ahead),
  // OFF_GRID (not on a quarter hour), IN_PAST (staff need `backdated`) or BEFORE_OUTBOUND (a return before its
  // outbound). `leg` says which trip.
  "PICKUP_TIME_INVALID",
  // The passengers or the luggage don't fit the car body.
  "LOAD_DOES_NOT_FIT",
  // The booker already has the most pending trips allowed (3). Wait for one to be confirmed, or cancel one.
  "PENDING_TRIP_LIMIT",
  // The price isn't the one the booker saw (`expectedPrice`). `price` is the current one, null when there's none (book on
  // request), and `leg` says which trip.
  "PRICE_CHANGED",
  // A staff member booking on their own must give the trip a price: only a customer's trip can wait for one. `leg` says
  // which trip.
  "PRICE_REQUIRED",
  // The customer named in a staff booking doesn't exist or isn't active.
  "CUSTOMER_NOT_AVAILABLE",

  // Trip lifecycle
  // The trip isn't in a status this action applies to (someone else may have just moved it). `status` is its current one.
  "TRIP_STATUS_CONFLICT",
  // A confirmed trip can't be cancelled online: the booker has to call.
  "CALL_TO_CANCEL",
  // Confirming needs a price the booker saw: quoted at booking, or proposed and accepted.
  "PRICE_NOT_ACCEPTED",
  // Starting needs a driver and a vehicle, or an office.
  "ASSIGNMENT_REQUIRED",
  // The driver or the vehicle (`field`) is already on a trip in progress.
  "ASSIGNEE_BUSY",
  // Reopening a completed trip after its month's report was generated.
  "MONTH_REPORT_GENERATED",

  // Price on request
  // Proposing a price for a trip that isn't pending with a requested or proposed price.
  "PRICE_NOT_REQUESTED",
  // Accepting or declining when there's no proposed price waiting.
  "PRICE_NOT_PROPOSED",
  // Editing the price of a trip whose price is requested or proposed: propose one instead.
  "PRICE_REQUEST_OPEN",

  // Assignment
  // The driver or the vehicle named doesn't exist or is archived.
  "DRIVER_NOT_AVAILABLE",
  "VEHICLE_NOT_AVAILABLE",
  // The vehicle's body is smaller than the trip's.
  "VEHICLE_TOO_SMALL",
  // A trip handed to an office can only have that office's driver and vehicle.
  "ASSIGNMENT_OFFICE_MISMATCH",
  // The driver or the vehicle has another live trip within 3 hours of this pickup. `conflicts` lists them; send
  // `acknowledgeConflicts` to assign anyway.
  "ASSIGNMENT_CONFLICT",

  // Linked trips
  // One of the trips already has a linked trip: unlink it first.
  "TRIP_ALREADY_LINKED",
  // The trips can't be linked: the same trip, or a return that picks up before the outbound.
  "TRIP_LINK_INVALID",
  // Unlinking a trip that has no linked trip.
  "TRIP_NOT_LINKED",
] as const;

export type ErrorCode = (typeof errorCodes)[number];
