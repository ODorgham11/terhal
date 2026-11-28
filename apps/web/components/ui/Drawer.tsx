"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
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
  // How far the body has scrolled: at the top the header sits flat on the page with its full title; once the body
  // moves under it, the header draws its line and the title settles a size smaller. The footer's line shows only
  // while there's more below it.
  const body = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ top: true, bottom: true });
  const measure = useCallback(() => {
    const element = body.current;
    if (!element) return;
    const top = element.scrollTop <= 1;
    const bottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    setEdges((current) =>
      current.top === top && current.bottom === bottom ? current : { top, bottom },
    );
  }, []);
  // The body grows and shrinks (a field opening, data arriving) without scrolling, so it's measured then too.
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      observer.current?.disconnect();
      body.current = element;
      if (!element) return;
      observer.current = new ResizeObserver(measure);
      observer.current.observe(element);
      for (const child of Array.from(element.children)) observer.current.observe(child);
      measure();
    },
    [measure],
  );
  useEffect(() => () => observer.current?.disconnect(), []);
  const scrolled = !edges.top;

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
        <div
          className={cn(
            "flex items-start justify-between gap-4 border-b px-5 transition-[padding,border-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            scrolled ? "border-border pt-4 pb-3" : "border-transparent pt-7 pb-4",
          )}
        >
          <div className="flex flex-col gap-1">
            <Primitive.Title
              className={cn(
                "font-semibold text-foreground transition-[font-size,line-height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                scrolled ? "text-lg leading-6" : "text-xl leading-7",
              )}
            >
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
        <div ref={attach} onScroll={measure} className="flex-1 overflow-y-auto px-5 pt-1 pb-5">
          {children}
        </div>
        {footer && (
          <div
            className={cn(
              "flex justify-end gap-2 border-t p-4 transition-colors duration-300",
              edges.bottom ? "border-transparent" : "border-border",
            )}
          >
            {footer}
          </div>
        )}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
