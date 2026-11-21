"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Admin, Customer, Guest, Staff } from "@terhal/contracts";
import {
  adminApi,
  call,
  isApiError,
  onSignedOut,
  siteApi,
  staffApi,
  type ApiError,
  type Audience,
  type ClientErrorCode,
} from "@/lib/api";

// Who's signed in, per audience. The auth cookies are httpOnly and host-only on the API, so the Next server can't see
// them: sessions are checked in the browser, through each audience's session route, and cached by TanStack Query.

export type SessionKind = Audience | "guest";

export type SessionState<User> =
  | { status: "loading" }
  | { status: "signed-in"; user: User }
  // No session, or one that ended (expired, revoked, the account deactivated). `reason` is the API's code.
  | { status: "signed-out"; reason: ClientErrorCode }
  // A guest who hasn't confirmed the emailed code yet.
  | { status: "unverified" }
  // The API couldn't be reached or failed: not the same as signed out, so offer a retry instead of sending them away.
  | { status: "error"; error: ApiError; retry: () => void };

type Settled<User> = Exclude<SessionState<User>, { status: "loading" } | { status: "error" }>;

export const sessionKey = (kind: SessionKind) => ["session", kind] as const;

const fetchers = {
  admin: () => call(adminApi.auth.session.$get()),
  staff: () => call(staffApi.auth.session.$get()),
  customer: () => call(siteApi.auth.session.$get()),
  guest: () => call(siteApi.guest.$get()),
} satisfies Record<SessionKind, () => Promise<unknown>>;

type UserOf = { admin: Admin; staff: Staff; customer: Customer; guest: Guest };

// A 401 or 403 is an answer ("not signed in", "not active", "not verified"), not a failure.
const settle = async <User>(fetch: () => Promise<User>): Promise<Settled<User>> => {
  try {
    return { status: "signed-in", user: await fetch() };
  } catch (error) {
    if (!isApiError(error) || (error.status !== 401 && error.status !== 403)) throw error;
    if (error.code === "VERIFICATION_REQUIRED") return { status: "unverified" };
    return { status: "signed-out", reason: error.code };
  }
};

function useSession<K extends SessionKind>(kind: K): SessionState<UserOf[K]> {
  const query = useQuery({
    queryKey: sessionKey(kind),
    queryFn: () => settle(fetchers[kind] as () => Promise<UserOf[K]>),
    // A session rarely changes under a page; refetching on focus catches one ended elsewhere.
    staleTime: 5 * 60 * 1000,
  });

  if (query.data) return query.data;
  if (query.isError) {
    return {
      status: "error",
      error: query.error as ApiError,
      retry: () => {
        void query.refetch();
      },
    };
  }
  return { status: "loading" };
}

export const useAdminSession = () => useSession("admin");
export const useStaffSession = () => useSession("staff");
export const useCustomerSession = () => useSession("customer");
export const useGuest = () => useSession("guest");

// Marks the audience signed out as soon as lib/api's refresh is refused, so every guard on the page reacts at once
// instead of waiting for its next request. Rendered by each host's providers.
export function useSignedOutWatcher(audience: Audience) {
  const client = useQueryClient();

  useEffect(
    () =>
      onSignedOut(audience, () => {
        client.setQueryData(sessionKey(audience), {
          status: "signed-out",
          reason: "INVALID_REFRESH_TOKEN",
        } satisfies Settled<unknown>);
      }),
    [audience, client],
  );
}
