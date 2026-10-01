import type { Metadata } from "next";

// Only here for the title, since the page is a client component and can't export metadata itself.
export const metadata: Metadata = {
    title: "Sign up",
};

export default function SignUpLayout({ children }: LayoutProps<"/auth/sign-up">) {
    return children;
}
