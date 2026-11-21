import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, defaultLocale, isLocale } from "./locales";

// Runs on the server for every request: the locale comes from the cookie the locale switcher writes, not from the URL.
export default getRequestConfig(async () => {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : defaultLocale;
  const messages = (await import(`../messages/${locale}.json`)) as { default: Messages };

  return { locale, messages: messages.default, timeZone: "Africa/Cairo" };
});
