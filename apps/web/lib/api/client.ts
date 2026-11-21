import { hc } from "hono/client";
import type { AppType } from "@terhal/server/client";
import { readError } from "./errors";

export const endpoint = process.env.NEXT_PUBLIC_API_URL ?? "https://api.local.terhal.co:8080";

// The audiences with refreshable sessions. Guests have one opaque session cookie and nothing to refresh.
export type Audience = "admin" | "staff" | "customer";

const refreshPaths: Record<Audience, string> = {
  admin: "/v1/admin/auth/refresh",
  staff: "/v1/staff/auth/refresh",
  customer: "/v1/site/auth/refresh",
};

const audienceOf = (input: RequestInfo | URL): Audience | null => {
  const url = new URL(input instanceof Request ? input.url : input.toString(), endpoint);
  if (url.pathname.startsWith("/v1/admin/")) return "admin";
  if (url.pathname.startsWith("/v1/staff/")) return "staff";
  if (url.pathname.startsWith("/v1/site/")) return "customer";
  return null;
};

// "Signed out" notices: a refresh the API refused means the session is over (expired, revoked, signed out elsewhere).
// The session providers listen and send the person to sign in.
type SignedOutListener = () => void;
const signedOutListeners: Record<Audience, Set<SignedOutListener>> = {
  admin: new Set(),
  staff: new Set(),
  customer: new Set(),
};

export const onSignedOut = (audience: Audience, listener: SignedOutListener) => {
  signedOutListeners[audience].add(listener);
  return () => {
    signedOutListeners[audience].delete(listener);
  };
};

const reportSignedOut = (audience: Audience) => {
  for (const listener of signedOutListeners[audience]) listener();
};

type RefreshResult = "refreshed" | "signed-out" | "unreachable";

// One refresh per audience at a time: when several requests expire together, they all wait on the same one. The API
// rotates the refresh token, so two refreshes racing would have the second rejected.
const refreshing: Partial<Record<Audience, Promise<RefreshResult>>> = {};

const refresh = (audience: Audience) => {
  refreshing[audience] ??= fetch(`${endpoint}${refreshPaths[audience]}`, {
    method: "POST",
    credentials: "include",
  })
    .then((response): RefreshResult => (response.ok ? "refreshed" : "signed-out"))
    .catch((): RefreshResult => "unreachable")
    .finally(() => {
      delete refreshing[audience];
    });

  return refreshing[audience];
};

// Tokens live in httpOnly cookies on the API's host, so every request includes credentials and the page never sees
// them. When the access token has expired (401 ACCESS_TOKEN_EXPIRED), refresh it once and replay the request.
const appFetch: typeof fetch = async (input, init) => {
  const send = () => fetch(input, { ...init, credentials: "include" });
  const response = await send();
  if (response.status !== 401) return response;

  const audience = audienceOf(input);
  if (!audience) return response;

  const { code } = await readError(response);
  if (code !== "ACCESS_TOKEN_EXPIRED") return response;

  const result = await refresh(audience);
  if (result === "signed-out") reportSignedOut(audience);
  // Unreachable isn't signed out: hand back the 401 and let the caller retry later.
  if (result !== "refreshed") return response;

  return send();
};

// Typed against the server's routes. Each audience's routes are reachable only from its own host, so a page uses the
// one for its host: adminApi on admin., staffApi on dashboard., siteApi on the customer site.
//
//   const admin = await call(adminApi.auth.session.$get());
export const api = hc<AppType>(endpoint, { fetch: appFetch });

export const adminApi = api.v1.admin;
export const staffApi = api.v1.staff;
export const siteApi = api.v1.site;
