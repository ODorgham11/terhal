import { LOCALE_COOKIE, type Locale } from "./locales";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Written in the browser, so it works the same on every host without a server round trip: the cookie is host-only and
// path=/, so each of terhal.co, dashboard. and admin. keeps its own choice. The caller re-renders with router.refresh(),
// which runs i18n/request.ts again with the new cookie.
export const setLocaleCookie = (locale: Locale) => {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`;
};
