import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionConfig } from "motion/react";
import { AuthProvider } from "@/context/auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Todo: Modify this as soon as we can get the domain name up and running.
// const siteUrl = "https://terhal.com";

export const metadata: Metadata = {
  // metadataBase: new URL(siteUrl),
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
      // url: siteUrl,
    },
  ],
  creator: "Terhal",
  publisher: "Terhal",
  category: "travel",
  alternates: {
    canonical: "/",
    languages: {
      en: "/en",
      ar: "/ar",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_EG",
    alternateLocale: ["ar_EG"],
    // url: siteUrl,
    siteName: "Terhal",
    title: "Terhal | Car Rental & Transportation in Egypt",
    description:
      "Reliable car rental, airport transfers, private transportation, and chauffeur services across Egypt.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "Terhal - Car Rental & Transportation in Egypt",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Terhal | Car Rental & Transportation in Egypt",
    description:
      "Car rental, airport transfers, and private transportation across Egypt.",
    images: ["/og-image.jpg"],
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