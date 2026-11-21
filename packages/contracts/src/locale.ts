import { z } from "zod";

// The languages every host is served in; Arabic is the default. Accounts and guest sessions keep theirs, so emails and
// notifications go out in it.
export const locales = ["ar", "en"] as const;
export const Locale = z.enum(locales).meta({ id: "Locale" });
export type Locale = z.infer<typeof Locale>;

export const DEFAULT_LOCALE: Locale = "ar";
