import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// A placeholder block in the shape of what's loading. Size it with className (h-4 w-32, say).
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-muted", className)}
      {...props}
    />
  );
}
