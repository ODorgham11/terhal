import type { Metadata } from "next";

// The public URL of the site, used to turn relative metadata paths into the absolute URLs that link previews need.
// Set SITE_URL once the domain is live. Until then, Vercel's production URL is used there, and localhost everywhere else.
export const siteUrl = process.env.SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

// The Open Graph fields every page shares. Next replaces the whole openGraph object when a page sets its own,
// so pages that add a field (like url) spread this in to keep the rest.
export const openGraph = {
    type: "website",
    locale: "en_EG",
    siteName: "Terhal",
    title: "Terhal | Car Rental & Transportation in Egypt",
    description: "Reliable car rental, airport transfers, private transportation, and chauffeur services across Egypt.",
} satisfies Metadata["openGraph"];
