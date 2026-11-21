"use client";

import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Dialog as Primitive } from "radix-ui";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/cn";

// A modal on Radix Dialog: focus is trapped and restored, Escape and the backdrop close it, and the page behind can't
// scroll. Uncontrolled with a trigger, or controlled with open/onOpenChange:
//
//   <Dialog>
//     <DialogTrigger asChild><Button>{t("invite")}</Button></DialogTrigger>
//     <DialogContent title={t("inviteTitle")} description={t("inviteHint")}>
//       ...form...
//       <DialogFooter><DialogClose asChild><Button variant="secondary">{t("cancel")}</Button></DialogClose></DialogFooter>
//     </DialogContent>
//   </Dialog>
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

type DialogContentProps = Omit<ComponentProps<typeof Primitive.Content>, "title"> & {
  // Required: it names the dialog for screen readers.
  title: ReactNode;
  description?: ReactNode;
};

export function DialogContent({
  title,
  description,
  className,
  children,
  ...props
}: DialogContentProps) {
  const t = useTranslations("common.ui");

  return (
    <Primitive.Portal>
      <Primitive.Overlay className="animate-overlay fixed inset-0 z-50 bg-overlay" />
      <Primitive.Content
        // Without a description, tell Radix there isn't one instead of pointing at nothing.
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          // Centered with inset-0 and auto margins, which needs no left or right.
          "animate-pop fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex flex-col gap-1 pe-8">
          <Primitive.Title className="text-lg font-semibold text-foreground">
            {title}
          </Primitive.Title>
          {description && (
            <Primitive.Description className="text-sm text-muted">
              {description}
            </Primitive.Description>
          )}
        </div>
        {children}
        <Primitive.Close
          aria-label={t("close")}
          className="absolute end-4 top-4 rounded-md p-1 text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <IconX aria-hidden className="size-4" />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
