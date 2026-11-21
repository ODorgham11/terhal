"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconLanguage } from "@tabler/icons-react";
import { locales, type Locale } from "@/i18n/locales";
import { setLocaleCookie } from "@/i18n/set-locale";
import { cn } from "@/lib/cn";

// Each language is named in itself, so someone who can't read the current one can still find theirs.
const names: Record<Locale, string> = { ar: "العربية", en: "English" };

// Switches to the other language. With two languages a toggle is one click instead of a menu.
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations("common.locale");
  const current = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locales.find((locale) => locale !== current) ?? current;

  const change = () => {
    setLocaleCookie(next);
    // Re-renders the server components, <html lang dir> included, with the new cookie.
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={change}
      disabled={pending}
      aria-label={t("switchTo", { language: names[next] })}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
        className,
      )}
    >
      <IconLanguage className="size-4" aria-hidden />
      <span lang={next}>{names[next]}</span>
    </button>
  );
}
