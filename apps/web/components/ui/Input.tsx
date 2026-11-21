"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

type InputProps = ComponentProps<"input"> & {
  // Inside the box at the inline start or end: an icon, a unit, a show-password toggle.
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
};

export function Input({ startAdornment, endAdornment, className, ...props }: InputProps) {
  const field = useFieldControl(props);
  const adorned = Boolean(startAdornment) || Boolean(endAdornment);
  const input = (
    <input
      {...props}
      {...field}
      className={cn(
        controlClasses,
        "h-10",
        Boolean(startAdornment) && "ps-9",
        Boolean(endAdornment) && "pe-10",
        !adorned && className,
      )}
    />
  );

  if (!adorned) return input;

  return (
    <div className={cn("relative", className)}>
      {startAdornment && (
        <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-muted">
          {startAdornment}
        </span>
      )}
      {input}
      {endAdornment && (
        <span className="absolute inset-y-0 end-0 flex items-center pe-1.5 text-muted">
          {endAdornment}
        </span>
      )}
    </div>
  );
}
