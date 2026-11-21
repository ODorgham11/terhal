import { hc } from "hono/client";
import type { ErrorCode, Problem, ValidationProblem } from "@terhal/contracts";
import type { AppType } from "@terhal/server/client";

const endpoint = process.env.NEXT_PUBLIC_API_URL ?? "https://api.local.terhal.co:8080";

// A failed request, as the forms use it. The API answers every error with RFC 9457 problem details
// (@terhal/contracts Problem); validation failures list each field's problem in `errors`.
export type ApiError = {
  code?: ErrorCode;
  message: string;
  fields: { field: string; message: string }[];
};

// Not every failure is the API's JSON (e.g. a proxy's plain text 502), so this never assumes it is.
export const readError = async (res: Response): Promise<ApiError> => {
  const body = (await res.json().catch(() => null)) as Partial<Problem> | null;
  if (!body?.detail) return { message: `The server responded with ${res.status}.`, fields: [] };

  const issues = body.code === "VALIDATION_FAILED" ? (body as ValidationProblem).errors : [];
  return {
    code: body.code,
    message: body.detail,
    fields: issues.map((issue) => ({ field: issue.path, message: issue.message })),
  };
};

// Tokens live in http-only cookies, so every request includes credentials.
const appFetch: typeof fetch = (input, init) => fetch(input, { ...init, credentials: "include" });

// Typed against the backend's routes, e.g. api.v1.admin.session.$get().
export const api = hc<AppType>(endpoint, { fetch: appFetch });
