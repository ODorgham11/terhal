"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Direction, Toast as Primitive } from "radix-ui";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { Tone } from "./Badge";

type ToastTone = Exclude<Tone, "neutral">;

type ToastItem = {
  id: number;
  tone: ToastTone;
  // Already translated.
  title: string;
  description?: string;
  duration?: number;
};

// A tiny store outside React, so a toast can be raised from anywhere: an event handler, a mutation's onError.
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const empty: ToastItem[] = [];

const show = (item: Omit<ToastItem, "id">) => {
  const id = nextId++;
  // Keep the last few: a burst of failures shouldn't bury the page.
  items = [...items.slice(-3), { ...item, id }];
  emit();
  return id;
};

const dismiss = (id: number) => {
  items = items.filter((item) => item.id !== id);
  emit();
};

// Pass translated text:  toast.success(t("saved"));  toast.error(errorMessage(error));
export const toast = {
  show,
  dismiss,
  success: (title: string, description?: string) => show({ tone: "success", title, description }),
  error: (title: string, description?: string) => show({ tone: "danger", title, description }),
  warning: (title: string, description?: string) => show({ tone: "warning", title, description }),
  info: (title: string, description?: string) => show({ tone: "info", title, description }),
};

const styles: Record<ToastTone, { icon: typeof IconInfoCircle; color: string }> = {
  info: { icon: IconInfoCircle, color: "text-info" },
  success: { icon: IconCircleCheck, color: "text-success" },
  warning: { icon: IconAlertTriangle, color: "text-warning" },
  danger: { icon: IconAlertCircle, color: "text-danger" },
};

// Rendered once per host, in its providers. Toasts stack at the bottom inline end and swipe away toward that edge.
export function Toaster() {
  const t = useTranslations("common.ui");
  const direction = Direction.useDirection();
  const current = useSyncExternalStore(
    subscribe,
    () => items,
    () => empty,
  );

  return (
    <Primitive.Provider
      label={t("notifications")}
      swipeDirection={direction === "rtl" ? "left" : "right"}
      duration={5000}
    >
      {current.map((item) => {
        const { icon: Icon, color } = styles[item.tone];
        return (
          <Primitive.Root
            key={item.id}
            type={item.tone === "danger" ? "foreground" : "background"}
            duration={item.duration}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className="animate-pop flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-lg data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform"
          >
            <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", color)} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Primitive.Title className="text-sm font-medium text-foreground">
                {item.title}
              </Primitive.Title>
              {item.description && (
                <Primitive.Description className="text-sm text-muted">
                  {item.description}
                </Primitive.Description>
              )}
            </div>
            <Primitive.Close
              aria-label={t("dismiss")}
              className="rounded-md p-0.5 text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <IconX aria-hidden className="size-4" />
            </Primitive.Close>
          </Primitive.Root>
        );
      })}
      <Primitive.Viewport className="fixed end-0 bottom-0 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
    </Primitive.Provider>
  );
}
