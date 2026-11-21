"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      {...props}
      {...useFieldControl(props)}
      className={cn(controlClasses, "min-h-20 py-2", className)}
    />
  );
}
