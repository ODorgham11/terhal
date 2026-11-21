import { errorCodes, type ErrorCode, type ValidationIssue } from "@terhal/contracts";

// The API's codes, plus two the client gives a failure that never reached the API or didn't come back as a problem.
export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "UNEXPECTED_RESPONSE";

// A failed request. The API answers every error with RFC 9457 problem details (@terhal/contracts Problem): switch on
// `code`, never on `detail`, which is English and for logs. Show errorMessage(error) from lib/api/messages instead.
export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  // One entry per field for VALIDATION_FAILED, otherwise empty.
  readonly errors: ValidationIssue[];
  readonly requestId: string | undefined;

  constructor(options: {
    status: number;
    code: ClientErrorCode;
    detail: string;
    errors?: ValidationIssue[];
    requestId?: string;
  }) {
    super(options.detail);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.errors = options.errors ?? [];
    this.requestId = options.requestId;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" && (errorCodes as readonly string[]).includes(value);

const isIssue = (value: unknown): value is ValidationIssue =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ValidationIssue).path === "string" &&
  typeof (value as ValidationIssue).code === "string";

// Not every failure is the API's JSON (a proxy's plain-text 502, say), so this never assumes it is.
export const readError = async (response: Response): Promise<ApiError> => {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  const problem = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  if (!isErrorCode(problem.code)) {
    return new ApiError({
      status: response.status,
      code: "UNEXPECTED_RESPONSE",
      detail: `The server responded with ${response.status}.`,
    });
  }

  return new ApiError({
    status: response.status,
    code: problem.code,
    detail: typeof problem.detail === "string" ? problem.detail : problem.code,
    errors: Array.isArray(problem.errors) ? problem.errors.filter(isIssue) : [],
    requestId: typeof problem.requestId === "string" ? problem.requestId : undefined,
  });
};

// fetch() rejects when the request never got an answer: offline, DNS, CORS, a dropped connection.
export const networkError = (cause: unknown) =>
  new ApiError({
    status: 0,
    code: "NETWORK_ERROR",
    detail: cause instanceof Error ? cause.message : "The request failed.",
  });
