"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

type InputProps = ComponentProps<"input"> & {
    label: string;
    error?: string;
    // Rendered inside the box on the right, e.g. the show/hide toggle on a password.
    trailing?: ReactNode;
};

// A bordered box with the label sitting inside it, above the value.
export default function Input({ label, error, trailing, id, className, ...props }: InputProps) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;

    return (
        <div className={className}>
            <div
                className={cn(
                    "flex items-center gap-3 rounded-lg border bg-white px-3 py-2 transition-colors focus-within:ring-2",
                    error
                        ? "border-red-500 focus-within:ring-red-500/20"
                        : "border-neutral-300 focus-within:border-neutral-900 focus-within:ring-neutral-900/10",
                )}
            >
                <div className="flex min-w-0 flex-1 flex-col">
                    <label htmlFor={inputId} className="text-xs text-neutral-600">{label}</label>
                    <input
                        id={inputId}
                        aria-invalid={!!error}
                        aria-describedby={error ? errorId : undefined}
                        className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                        {...props}
                    />
                </div>
                {trailing}
            </div>
            <AnimatePresence initial={false}>
                {error && (
                    <motion.p
                        key="error"
                        id={errorId}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="overflow-hidden text-xs text-red-600"
                    >
                        <span className="block pt-1.5">{error}</span>
                    </motion.p>
                )}
            </AnimatePresence>
        </div>
    );
}
