"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth";
import Logo from "@/components/ui/logo";
import Button from "@/components/ui/button";

// The staff dashboard's home. A placeholder for now, showing who's signed in.
export default function Dashboard() {
    const router = useRouter();
    const { user, signOut } = useAuth();
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async () => {
        setSigningOut(true);
        await signOut();
        router.replace("/auth/sign-in");
    };

    return (
        <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Logo />
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">Staff</span>
                </div>
                <Button variant="secondary" loading={signingOut} onClick={handleSignOut}>Sign out</Button>
            </div>

            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Welcome, {user?.firstName}</h1>
                <p className="text-sm text-neutral-500">Signed in as {user?.firstName} {user?.lastName} ({user?.email}). The staff dashboard is coming soon.</p>
            </div>
        </div>
    );
}
