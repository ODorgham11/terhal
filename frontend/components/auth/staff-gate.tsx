"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/context/auth";

// Only renders its children for signed in staff. Everyone else is sent away before anything shows: signed out visitors
// to sign in, and customers to the main site. This only hides the pages; staff-only data must still be checked on the
// backend with authorize([UserRole.STAFF]).
export default function StaffGate({ children }: { children: ReactNode }) {
    const router = useRouter();
    const { setUser } = useAuth();
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        // Checked here rather than read from the auth context, since the context can't tell "still loading" from "signed out".
        api.auth.session.$get()
            .then(async (res) => {
                if (!res.ok) return router.replace("/auth/sign-in");

                const { user } = (await res.json()).data;
                setUser(user);

                if (user.role !== "STAFF") return router.replace("/");
                setAllowed(true);
            })
            .catch(() => router.replace("/auth/sign-in"));
    }, [router, setUser]);

    return allowed ? children : null;
}
