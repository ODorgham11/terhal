import type { Metadata } from "next";
import StaffGate from "@/components/auth/staff-gate";

export const metadata: Metadata = {
    title: "Dashboard",
    // Nothing behind the staff dashboard belongs in search results.
    robots: {
        index: false,
        follow: false,
    },
};

// Every page under /dashboard is for staff only.
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
    return (
        <StaffGate>
            <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col p-6 sm:p-10">{children}</main>
        </StaffGate>
    );
}
