import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Reset password",
};

export default function ResetPasswordLayout({ children }: LayoutProps<"/auth/reset-password">) {
    return children;
}
