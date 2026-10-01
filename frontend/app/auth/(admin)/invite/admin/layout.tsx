import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Set up your admin account",
};

export default function AdminInviteLayout({ children }: LayoutProps<"/auth/invite/admin">) {
    return children;
}
