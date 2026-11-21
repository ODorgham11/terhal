import type ar from "./ar.json";
import type en from "./en.json";

// Fails the type check when one language has a message the other doesn't. Messages are typed from en.json
// (global.d.ts), so a key missing from ar.json would otherwise only show up as a raw key on an Arabic page.
type Keys<T> = T extends string ? string : { [K in keyof T]: Keys<T[K]> };

export type ArabicHasEveryEnglishKey = Keys<typeof en> extends Keys<typeof ar> ? true : never;
export type EnglishHasEveryArabicKey = Keys<typeof ar> extends Keys<typeof en> ? true : never;

export const messagesMatch: [ArabicHasEveryEnglishKey, EnglishHasEveryArabicKey] = [true, true];
