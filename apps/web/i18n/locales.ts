// The interface's languages. Arabic is the default; the visitor's choice lives in a cookie, never in the URL, so
// proxy.ts only maps hosts (docs/decisions.md, "Arabic and English, right to left").
export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

// next-intl's conventional name. Host-only: each host (customer site, dashboard, admin panel) remembers its own choice.
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (locales as readonly string[]).includes(value);

export const directionOf = (locale: Locale) => (locale === "ar" ? "rtl" : "ltr");
