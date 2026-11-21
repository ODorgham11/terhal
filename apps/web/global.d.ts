import type { Locale } from "./i18n/locales";
import type messages from "./messages/en.json";

// Types every next-intl call: a key that isn't in the messages, or a locale that isn't supported, fails the type check.
// messages/check.ts makes sure Arabic has every English key and the other way round.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}

declare global {
  type Messages = typeof messages;
}
