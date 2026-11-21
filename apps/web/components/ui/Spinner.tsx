"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

type SpinnerProps = {
  className?: string;
  // Announced to screen readers. Pass null when something around it already says what's loading (a busy button).
  label?: string | null;
};

export function Spinner({ className, label }: SpinnerProps) {
  const t = useTranslations("common.ui");
  const text = label === undefined ? t("loading") : label;

  return (
    <span role={text ? "status" : undefined} className="inline-flex">
      <span
        aria-hidden
        className={cn(
          "size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
          className,
        )}
      />
      {text && <span className="sr-only">{text}</span>}
    </span>
  );
}
