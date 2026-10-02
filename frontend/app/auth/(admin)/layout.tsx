import type { ReactNode } from "react";
import Logo from "@/components/ui/logo";

// The admin auth pages: the same forms as the customer pages, across the full width of the screen without the photo,
// so it's always clear this is the admin side.
export default function AdminAuthLayout({ children }: { children: ReactNode }) {
    return (
        <main className="flex min-h-screen w-full flex-col p-6 sm:p-10">
            <div className="flex items-center gap-2.5">
                <Logo />
                <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs font-medium text-white">Admin</span>
            </div>
            <div className="flex flex-1 items-center justify-center py-12">
                <div className="w-full max-w-md">{children}</div>
            </div>
        </main>
    );
}
