"use client";

import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog as Primitive } from "radix-ui";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/cn";

// A panel that slides in from the inline end (the right in English, the left in Arabic): details of a row, a filter
// form, a mobile menu. The same Radix Dialog underneath, so the same focus and keyboard handling as Dialog.
//
//   <Drawer open={open} onOpenChange={setOpen}>
//     <DrawerContent title={t("tripDetails")}>...</DrawerContent>
//   </Drawer>
export const Drawer = Primitive.Root;
export const DrawerTrigger = Primitive.Trigger;
export const DrawerClose = Primitive.Close;

type DrawerContentProps = Omit<ComponentProps<typeof Primitive.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  // Pinned to the bottom, outside the scrolling body: the drawer's buttons.
  footer?: ReactNode;
};

export function DrawerContent({
  title,
  description,
  footer,
  className,
  children,
  ...props
}: DrawerContentProps) {
  const t = useTranslations("common.ui");

  return (
    <Primitive.Portal>
      <Primitive.Overlay className="animate-overlay fixed inset-0 z-50 bg-overlay" />
      <Primitive.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "animate-drawer fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col border-s border-border bg-surface shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-4">
          <div className="flex flex-col gap-1">
            <Primitive.Title className="text-xl leading-7 font-semibold text-foreground">
              {title}
            </Primitive.Title>
            {description && (
              <Primitive.Description className="text-sm text-muted">
                {description}
              </Primitive.Description>
            )}
          </div>
          <Primitive.Close
            aria-label={t("close")}
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <IconX aria-hidden className="size-4" />
          </Primitive.Close>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>
        )}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
