import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Join the Terhal team",
};

export default function StaffInviteLayout({ children }: LayoutProps<"/auth/invite/staff">) {
    return children;
}
