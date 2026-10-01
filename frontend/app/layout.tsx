import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionConfig } from "motion/react";
import { AuthProvider } from "@/context/auth";
import { openGraph, siteUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

// Shared by every page. The share images come from app/opengraph-image.jpg and app/twitter-image.jpg, and the icons
// from app/icon.svg, app/apple-icon.tsx and app/favicon.ico, so none of them are listed here.
export const metadata: Metadata = {
  // Lets the fields below use relative paths, which link previews need as absolute URLs.
  metadataBase: new URL(siteUrl),
  title: {
    default: "Terhal | Car Rental & Transportation in Egypt",
    template: "%s | Terhal",
  },
  description: "Rent a car in Egypt with Terhal. Book reliable cars, airport transfers, private transportation, and chauffeur services across Cairo, Alexandria, and destinations throughout Egypt.",
  keywords: [
    "car rental Egypt",
    "car rental in Egypt",
    "rent a car Egypt",
    "Egypt car rental",
    "car rental Cairo",
    "car rental Alexandria",
    "airport car rental Egypt",
    "Cairo airport car rental",
    "private car Egypt",
    "chauffeur service Egypt",
    "private driver Egypt",
    "airport transfer Egypt",
    "airport transfer Cairo",
    "transportation Egypt",
    "Egypt transportation",
    "travel Egypt",
    "Terhal",
  ],
  applicationName: "Terhal",
  authors: [
    {
      name: "Terhal",
      url: siteUrl,
    },
  ],
  creator: "Terhal",
  publisher: "Terhal",
  category: "travel",
  // The canonical URL is set per page (see app/page.tsx), since one set here would be inherited by every page.
  // Todo: Add alternates.languages once the Arabic version of the site exists.
  openGraph,
  twitter: {
    card: "summary_large_image",
    title: "Terhal | Car Rental & Transportation in Egypt",
    description:
      "Car rental, airport transfers, and private transportation across Egypt.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    // Todo: Add these as soon as possible when we can get them available.
    // google: "YOUR_GOOGLE_SEARCH_CONSOLE_TOKEN",
    // yandex: "YOUR_YANDEX_TOKEN",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Turns movement off app-wide for people who ask their OS to reduce motion, keeping only the fades. */}
        <MotionConfig reducedMotion="user">
          <AuthProvider>{children}</AuthProvider>
        </MotionConfig>
      </body>
    </html>
  );
}