"use client";

import { AnimatePresence, motion } from "motion/react";

// An error about the whole form rather than one field, e.g. wrong credentials or the server being unreachable.
export default function FormError({ message }: { message?: string }) {
    return (
        <AnimatePresence initial={false}>
            {message && (
                <motion.p
                    key="form-error"
                    role="alert"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="text-sm text-red-600"
                >
                    {message}
                </motion.p>
            )}
        </AnimatePresence>
    );
}
