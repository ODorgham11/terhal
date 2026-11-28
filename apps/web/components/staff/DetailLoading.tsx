"use client";

import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";

// A SectionCard in gray: its title, then `lines` lines of content.
export function CardLoading({ lines }: { lines: number }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-5 shadow-xs">
      <div className="flex h-8 items-center">
        <Skeleton className="h-4.5 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: lines }, (_, line) => (
          <Skeleton key={line} className={line % 2 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
      </div>
    </div>
  );
}

type DetailLoadingProps = {
  // The title's width, and one width per header button (w-28, say).
  title?: string;
  buttons?: string[];
  badge?: boolean;
  // Line counts of the cards in the main column and the side column.
  main?: number[];
  side?: number[];
};

// A detail page's own shape in gray: breadcrumb, header and both columns of cards, so nothing moves when it arrives.
export function DetailLoading({
  title = "w-44",
  buttons = ["w-28", "w-24"],
  badge = true,
  main = [3, 5],
  side = [5, 3],
}: DetailLoadingProps) {
  const t = useTranslations("common.ui");
  return (
    <motion.div {...fade} role="status" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-3.5 w-36" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className={`h-8 ${title}`} />
            {badge && <Skeleton className="h-5.5 w-20 rounded-full" />}
          </div>
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        {buttons.length > 0 && (
          <div className="flex gap-2">
            {buttons.map((width, index) => (
              <Skeleton key={index} className={`h-10 rounded-lg ${width}`} />
            ))}
          </div>
        )}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {main.map((lines, index) => (
            <CardLoading key={index} lines={lines} />
          ))}
        </div>
        <div className="flex flex-col gap-5">
          {side.map((lines, index) => (
            <CardLoading key={index} lines={lines} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
