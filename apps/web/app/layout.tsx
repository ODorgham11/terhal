import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { directionOf } from "@/i18n/locales";
import "./globals.css";

// One family for both languages: IBM Plex Sans Arabic draws Arabic and Latin to the same design, so a page that mixes
// them (an English name in an Arabic sentence, a code, an email) keeps one rhythm and one x-height. Self-hosted by
// next/font, so browsers never call Google.
const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-plex",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("appName") };
}

// The locale comes from the NEXT_LOCALE cookie (i18n/request.ts). Arabic sets dir="rtl" on <html>, which flips every
// logical class (ms-, pe-, start-, text-end) and every rtl: variant at once.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html lang={locale} dir={directionOf(locale)} className={`${plex.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
