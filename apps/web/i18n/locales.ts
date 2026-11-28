import type { Section } from "@/lib/hosts";

// The interface's languages. The visitor's choice lives in a cookie, never in the URL, so proxy.ts only maps hosts
// (docs/decisions.md, "Arabic and English, right to left").
export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

// Before anyone picks a language: Arabic on the customer site and the admin panel, English on the staff dashboard, whose
// designs are in English (docs/decisions.md, "The staff dashboard defaults to English").
const defaultLocales: Record<Section, Locale> = { site: "ar", admin: "ar", staff: "en" };

export const defaultLocaleOf = (section: Section): Locale => defaultLocales[section];

// next-intl's conventional name. Host-only: each host (customer site, dashboard, admin panel) remembers its own choice.
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

export const directionOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");
