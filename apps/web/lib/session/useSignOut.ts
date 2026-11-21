"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { adminApi, call, siteApi, staffApi } from "@/lib/api";
import { adminRoutes, siteRoutes, staffRoutes } from "./routes";
import { sessionKey, type SessionKind } from "./sessions";

const signOutRequests = {
  admin: () => call(adminApi.auth["sign-out"].$post()),
  staff: () => call(staffApi.auth["sign-out"].$post()),
  customer: () => call(siteApi.auth["sign-out"].$post()),
  guest: () => call(siteApi.guest["sign-out"].$post()),
} satisfies Record<SessionKind, () => Promise<unknown>>;

const signInRoutes: Record<SessionKind, string> = {
  admin: adminRoutes.signIn,
  staff: staffRoutes.signIn,
  customer: siteRoutes.signIn,
  guest: siteRoutes.home,
};

// Ends the session on the API (which clears its cookies), forgets everything loaded under it, and goes to sign in.
//
//   const signOut = useSignOut("staff");
//   <DropdownMenuItem onSelect={() => void signOut()}>{t("signOut")}</DropdownMenuItem>
export function useSignOut(kind: SessionKind) {
  const client = useQueryClient();
  const router = useRouter();

  return useCallback(async () => {
    // Leave even if the request failed: signing out is what they asked for, and the API's sign-out always succeeds
    // when it's reached.
    await signOutRequests[kind]().catch(() => undefined);

    // The next person on this device mustn't see the last one's data.
    client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
    client.setQueryData(sessionKey(kind), { status: "signed-out", reason: "UNAUTHENTICATED" });
    router.replace(signInRoutes[kind]);
  }, [client, kind, router]);
}
