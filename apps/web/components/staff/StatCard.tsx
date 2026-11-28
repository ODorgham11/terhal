"use client";

import type { ReactNode } from "react";
import type { Icon } from "@tabler/icons-react";
import { FadeText } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

type StatCardProps = {
  icon: Icon;
  label: ReactNode;
  value: ReactNode;
  // A line under the number; `noteTone` colors it when it's a warning. `noteLoading` holds its place while it loads,
  // so the card doesn't grow when it arrives.
  note?: ReactNode;
  noteTone?: "muted" | "success" | "warning" | "accent" | "danger";
  noteLoading?: boolean;
  className?: string;
};

const noteTones = {
  muted: "text-muted",
  success: "text-success",
  warning: "text-warning",
  accent: "text-accent",
  danger: "text-danger",
};

// One number with its label: the overview's and analytics' KPIs. The number and note fade when they change.
export function StatCard({
  icon: Icon,
  label,
  value,
  note,
  noteTone = "muted",
  noteLoading = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-surface-muted p-1.5 text-foreground">
          <Icon aria-hidden className="size-4.5" stroke={1.75} />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm text-muted">{label}</p>
      </div>
      <p className="text-[1.75rem] leading-8.5 font-semibold text-foreground tabular-nums">
        <FadeText value={value} />
      </p>
      {noteLoading ? (
        <Skeleton className="h-4 w-28" />
      ) : (
        note && (
          <p className={cn("truncate text-xs transition-colors", noteTones[noteTone])}>
            <FadeText value={note} />
          </p>
        )
      )}
    </div>
  );
}
