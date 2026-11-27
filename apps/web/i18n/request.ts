import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { sectionOf } from "@/lib/hosts";
import { LOCALE_COOKIE, defaultLocaleOf, isLocale } from "./locales";

// Runs on the server for every request: the locale comes from the cookie the locale switcher writes, not from the URL,
// and without one from the host's default.
export default getRequestConfig(async () => {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : defaultLocaleOf(sectionOf((await headers()).get("host")));
  const messages = (await import(`../messages/${locale}.json`)) as { default: Messages };

  return { locale, messages: messages.default, timeZone: "Africa/Cairo" };
});
