import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Forgot password",
};

export default function ForgotPasswordLayout({ children }: LayoutProps<"/auth/forgot-password">) {
    return children;
}
