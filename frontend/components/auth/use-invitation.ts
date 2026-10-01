"use client";

import { useEffect, useState } from "react";
import type { ApiError } from "@/lib/api";

export type Invitation = { email: string; expiresAt: string };

type State =
    | { status: "loading" }
    | { status: "ready"; invitation: Invitation }
    | { status: "unusable"; message: string };

type LookupResponse = { ok: boolean; json: () => Promise<unknown> };

export function useInvitation(token: string | undefined, lookup: (token: string) => Promise<LookupResponse>) {
    const [state, setState] = useState<State>({ status: "loading" });

    useEffect(() => {
        if (token) window.history.replaceState(null, "", window.location.pathname);

        const load = async (): Promise<State> => {
            if (!token) return { status: "unusable", message: "This invitation link is incomplete. Open the link from your email again." };

            try {
                const res = await lookup(token);
                const body = await res.json();

                return res.ok
                    ? { status: "ready", invitation: (body as { data: { invitation: Invitation } }).data.invitation }
                    : { status: "unusable", message: (body as ApiError).error.message };
            } catch {
                return { status: "unusable", message: "Could not reach the server. Please check your connection and try again." };
            }
        };

        load().then(setState);
        // Only on mount: the token is read once from the link.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return state;
}
