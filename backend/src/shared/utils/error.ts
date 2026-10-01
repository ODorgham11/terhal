import type { ContentfulStatusCode } from "hono/utils/http-status";

// Create a set of standardized error codes that can be used to define and handle issues gracefully on the client-side.
export const ERROR_CODES = {
  // Generic
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  
  // Auth
  UNAUTHENTICATED: "UNAUTHENTICATED",
  EMAIL_ALREADY_IN_USE: "EMAIL_ALREADY_IN_USE",
  PHONE_ALREADY_IN_USE: "PHONE_ALREADY_IN_USE",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_NOT_ACTIVE: "ACCOUNT_NOT_ACTIVE",
  ACCOUNT_NOT_VERIFIED: "ACCOUNT_NOT_VERIFIED",
  ACCESS_TOKEN_EXPIRED: "ACCESS_TOKEN_EXPIRED",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",

  // Verification
  ALREADY_VERIFIED: "ALREADY_VERIFIED",
  VERIFICATION_COOLDOWN: "VERIFICATION_COOLDOWN",
  VERIFICATION_CODE_INVALID: "VERIFICATION_CODE_INVALID",
  VERIFICATION_CODE_EXPIRED: "VERIFICATION_CODE_EXPIRED",
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",

  // Invitations
  ACCOUNT_ALREADY_EXISTS: "ACCOUNT_ALREADY_EXISTS",
  INVITATION_INVALID: "INVITATION_INVALID",
  INVITATION_EXPIRED: "INVITATION_EXPIRED",
} as const;

export type ErrorCode =
  (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// Generic AppError class that will be used to parent/construct throwable error classes.
export default class AppError extends Error {
    public readonly statusCode: ContentfulStatusCode;
    public readonly isOperational: boolean;
    public readonly code: ErrorCode;

    constructor (statusCode: ContentfulStatusCode, message: string, code: ErrorCode, isOperational: boolean = true) {
       super(message);

       this.statusCode = statusCode;
       this.code = code;
       this.isOperational = isOperational;

       Error.captureStackTrace(this, this.constructor);
    }
};

export class BadRequestError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(400, message, code);
  }
};

export class UnauthorizedError extends AppError {
  constructor( message: string = 'Unauthorized', code: ErrorCode,) {
    super(401, message, code);
  }
};

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code: ErrorCode) {
    super(403, message, code);
  }
};

export class NotFoundError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(404, message, code);
  }
};

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(409, message, code);
  }
};

export class ValidationError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(422, message, code);
  }
};

export class TooManyRequestsError extends AppError {
  constructor(message: string, code: ErrorCode) {
    super(429, message, code);
  }
};

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', code: ErrorCode = "INTERNAL_SERVER_ERROR") {
    super(500, message, code, false);
  }
};

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable error', code: ErrorCode = "SERVICE_UNAVAILABLE") {
    super(503, message, code, false);
  }
};
