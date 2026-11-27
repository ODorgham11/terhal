import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
// Badges also come in the brand's two colors, for trip statuses (in progress, awaiting report).
export type BadgeTone = Tone | "primary" | "accent";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-foreground",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent-strong",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

// A short status label (Active, Suspended, Pending). Its text comes from messages like any other. `dot` puts a dot in
// the badge's color before the text, as trip statuses have.
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
