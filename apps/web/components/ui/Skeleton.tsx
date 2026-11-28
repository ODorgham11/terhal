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

// A cell's two lines (a name over its phone, say) in gray, the widths given as classes (w-32).
export function SkeletonLines({ first, second }: { first: string; second?: string }) {
  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <Skeleton className={cn("h-3.5", first)} />
      {second && <Skeleton className={cn("h-3", second)} />}
    </div>
  );
}
