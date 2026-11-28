"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

// A list of links inside a card (an office's drivers, a vehicle's trips): each row its own rounded hover, kept inside
// the card's edges so nothing is cut off.
export function LinkList({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn("-mx-1 flex flex-col gap-1", className)}>{children}</ul>;
}

export function LinkListItem({ href, children }: { href: string; children: ReactNode }) {
  return (
    <motion.li {...fade}>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      >
        {children}
      </Link>
    </motion.li>
  );
}

// Rows in gray, shaped like a LinkListItem with a leading square (an avatar, a thumbnail) and a trailing badge.
export function LinkListLoading({
  label,
  rows = 3,
  lead = true,
}: {
  label: string;
  rows?: number;
  lead?: boolean;
}) {
  return (
    <ul role="status" className="-mx-1 flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <li key={row} aria-hidden className="flex items-center gap-3 px-3 py-2.5">
          {lead && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={row % 2 ? "h-3.5 w-36" : "h-3.5 w-44"} />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5.5 w-20 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
