"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { cn } from "@/lib/cn";

// One easing for every change on a page, so nothing jumps: content fades, sizes ease.
export const ease: Transition = { duration: 0.22, ease: [0.32, 0.72, 0, 1] };

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: ease,
};

// Eases its height to whatever its content measures, so rows arriving or leaving don't shove the page.
export function AutoHeight({ className, children }: { className?: string; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useLayoutEffect(() => {
    const node = inner.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={cn("relative overflow-hidden", className)}
      initial={false}
      animate={{ height }}
      transition={ease}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

// Crossfades between states (loading, empty, the rows): the outgoing one fades over the incoming one while the
// height eases. Give each state a different `state`. With `instant`, the states swap at once and only the height eases
// (the overview, which shouldn't fade as it fills in).
export function Swap({
  state,
  instant = false,
  children,
}: {
  state: string;
  instant?: boolean;
  children: ReactNode;
}) {
  if (instant) {
    return (
      <AutoHeight>
        <div key={state}>{children}</div>
      </AutoHeight>
    );
  }
  return (
    <AutoHeight>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div key={state} {...fade}>
          {children}
        </motion.div>
      </AnimatePresence>
    </AutoHeight>
  );
}

// Text that fades when it changes (a count, a total) instead of flicking over.
export function FadeText({ value, className }: { value: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span key={String(value)} className={cn("inline-block", className)} {...fade}>
        {value}
      </motion.span>
    </AnimatePresence>
  );
}
