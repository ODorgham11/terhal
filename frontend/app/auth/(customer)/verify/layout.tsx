import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Verify your account",
};

export default function VerifyLayout({ children }: LayoutProps<"/auth/verify">) {
    return children;
}
