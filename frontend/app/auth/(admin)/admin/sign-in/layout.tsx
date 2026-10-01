import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Admin sign in",
};

export default function AdminSignInLayout({ children }: LayoutProps<"/auth/admin/sign-in">) {
    return children;
}
