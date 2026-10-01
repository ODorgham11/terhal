"use client";

import { useState, type ComponentProps } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import Input from "./input";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type" | "trailing">;

export default function PasswordInput(props: PasswordInputProps) {
    const [visible, setVisible] = useState(false);
    const Icon = visible ? IconEye : IconEyeOff;

    return (
        <Input
            type={visible ? "text" : "password"}
            trailing={
                <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? "Hide password" : "Show password"}
                    className="grid rounded p-1 text-neutral-500 hover:text-neutral-900"
                >
                    {/* Both icons share one grid cell, so the old one fades out while the new one fades in on top of it. */}
                    <AnimatePresence initial={false}>
                        <motion.span
                            key={visible ? "eye" : "eye-off"}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15, ease: "easeOut" }}
                            className="col-start-1 row-start-1"
                        >
                            <Icon className="size-5" stroke={1.75} aria-hidden />
                        </motion.span>
                    </AnimatePresence>
                </button>
            }
            {...props}
        />
    );
}
