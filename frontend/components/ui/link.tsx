import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export default function AppLink({ className, ...props }: ComponentProps<typeof Link>) {
    return (
        <Link
            className={cn("text-sm font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600", className)}
            {...props}
        />
    );
}
