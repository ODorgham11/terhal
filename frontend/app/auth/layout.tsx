import type { Metadata } from "next";

// Auth pages aren't useful search results, so keep them out of search engines.
// The layouts themselves live in the (customer) and (admin) route groups, which don't change the URLs.
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
    },
};

export default function AuthLayout({ children }: LayoutProps<"/auth">) {
    return children;
}
