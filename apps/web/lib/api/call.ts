import type { ClientResponse } from "hono/client";
import { networkError, readError } from "./errors";

type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206;

// The body of a route's successful responses: what it declares for 2xx JSON, undefined for an empty 202 or 204.
export type SuccessBody<R> =
  R extends ClientResponse<infer Body, infer Status, infer Format>
    ? Status extends SuccessStatus
      ? Format extends "json"
        ? Body
        : undefined
      : never
    : never;

// Sends an RPC request and returns its typed body, or throws an ApiError: the API's problem (with its code and
// validation errors), or NETWORK_ERROR when it never answered. Made for TanStack Query, whose queryFn and mutationFn
// expect a rejected promise on failure:
//
//   useQuery({ queryKey: ["admins"], queryFn: () => call(adminApi.admins.$get({ query: {} })) });
export async function call<R extends ClientResponse<unknown, number, string>>(
  request: Promise<R>,
): Promise<SuccessBody<R>> {
  let response: R;
  try {
    response = await request;
  } catch (error) {
    throw networkError(error);
  }

  if (!response.ok) throw await readError(response as unknown as Response);
  if (response.status === 204 || response.status === 202) return undefined as SuccessBody<R>;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as SuccessBody<R>;
}
