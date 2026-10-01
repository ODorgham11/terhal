import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Admin",
    // Nothing behind the admin area belongs in search results.
    robots: {
        index: false,
        follow: false,
    },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
    return <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col p-6 sm:p-10">{children}</main>;
}
