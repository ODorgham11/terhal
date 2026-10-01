"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Logo from "@/components/ui/logo";
import Button from "@/components/ui/button";

type Admin = { firstName: string; lastName: string; email: string };

// A placeholder for the admin dashboard, which shows who's signed in and lets them sign out.
// Signed out visitors are sent to admin sign in before anything renders.
export default function AdminHome() {
    const router = useRouter();
    const [admin, setAdmin] = useState<Admin | null>(null);
    const [signingOut, setSigningOut] = useState(false);

    useEffect(() => {
        api.admin.auth.session.$get()
            .then(async (res) => {
                if (res.ok) return setAdmin((await res.json()).data.admin);
                router.replace("/auth/admin/sign-in");
            })
            .catch(() => router.replace("/auth/admin/sign-in"));
    }, [router]);

    const signOut = async () => {
        setSigningOut(true);
        await api.admin.auth["sign-out"].$post().catch(() => null);
        router.replace("/auth/admin/sign-in");
    };

    if (!admin) return null;

    return (
        <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <Logo />
                    <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white">Admin</span>
                </div>
                <Button variant="secondary" loading={signingOut} onClick={signOut}>Sign out</Button>
            </div>

            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Welcome, {admin.firstName}</h1>
                <p className="text-sm text-neutral-500">Signed in as {admin.firstName} {admin.lastName} ({admin.email}). The admin dashboard is coming soon.</p>
            </div>
        </div>
    );
}
