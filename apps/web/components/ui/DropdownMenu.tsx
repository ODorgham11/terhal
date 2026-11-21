"use client";

import type { ComponentProps } from "react";
import { DropdownMenu as Primitive } from "radix-ui";
import { cn } from "@/lib/cn";

// A menu of actions on Radix DropdownMenu: arrow keys, typeahead, Escape, and it opens toward the inline end in either
// direction (DirectionProvider in the host's providers tells Radix which way that is).
//
//   <DropdownMenu>
//     <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={t("actions")}>…</Button></DropdownMenuTrigger>
//     <DropdownMenuContent>
//       <DropdownMenuItem onSelect={edit}>{t("edit")}</DropdownMenuItem>
//       <DropdownMenuSeparator />
//       <DropdownMenuItem destructive onSelect={remove}>{t("remove")}</DropdownMenuItem>
//     </DropdownMenuContent>
//   </DropdownMenu>
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;

export function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "animate-pop z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

type DropdownMenuItemProps = ComponentProps<typeof Primitive.Item> & {
  destructive?: boolean;
};

export function DropdownMenuItem({ destructive, className, ...props }: DropdownMenuItemProps) {
  return (
    <Primitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-muted [&_svg]:size-4",
        destructive ? "text-danger" : "text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn("px-2.5 py-1.5 text-xs font-medium text-muted", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
