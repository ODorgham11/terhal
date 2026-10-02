"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

type SessionBody = Awaited<ReturnType<Awaited<ReturnType<typeof api.auth.session.$get>>["json"]>>;

// Whatever the backend's session route returns, so this stays in sync with it.
export type User = SessionBody["data"]["user"];

type AuthContextValue = {
    user: User | null;
    // Reloads the user from the backend, e.g. after something changes their profile.
    refresh: () => Promise<void>;
    // Sets the user directly from a response that already includes them (sign in, sign up, verify), skipping a request.
    setUser: (user: User | null) => void;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// The signed in user, null when nobody is, or undefined when the server couldn't be reached and we don't know.
const loadSession = async (): Promise<User | null | undefined> => {
    try {
        const res = await api.auth.session.$get();
        return res.ok ? (await res.json()).data.user : null;
    } catch {
        return undefined;
    }
};

// Loads the signed in user once for the whole app. The tokens live in http-only cookies, so the only way to know
// who's signed in is to ask the backend. Expired access tokens are refreshed by the api client on the way.
export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);

    // Keeps whatever we had if the server can't be reached, rather than signing the user out over a network blip.
    const apply = useCallback((result: User | null | undefined) => {
        if (result !== undefined) setUser(result);
    }, []);

    const refresh = useCallback(async () => apply(await loadSession()), [apply]);

    const signOut = useCallback(async () => {
        try {
            await api.auth["sign-out"].$post();
        } finally {
            // Forget the user locally even if the request failed, since that's what they asked for.
            setUser(null);
        }
    }, []);

    useEffect(() => {
        loadSession().then(apply);
    }, [apply]);

    const value = useMemo<AuthContextValue>(() => ({
        user,
        refresh,
        setUser,
        signOut,
    }), [user, refresh, signOut]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error("useAuth must be used inside an AuthProvider.");

    return context;
}
