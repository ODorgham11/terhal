"use client";

import type { ComponentProps } from "react";
import { Tabs as Primitive } from "radix-ui";
import { cn } from "@/lib/cn";

// Radix Tabs: arrow keys move between tabs following the direction (right arrow goes back in Arabic).
//
//   <Tabs defaultValue="active">
//     <TabsList aria-label={t("filter")}>
//       <TabsTrigger value="active">{t("active")}</TabsTrigger>
//       <TabsTrigger value="archived">{t("archived")}</TabsTrigger>
//     </TabsList>
//     <TabsContent value="active">…</TabsContent>
//     <TabsContent value="archived">…</TabsContent>
//   </Tabs>
export function Tabs({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root className={cn("flex flex-col gap-4", className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return (
    <Primitive.List
      className={cn("flex gap-1 overflow-x-auto border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=active]:border-primary data-[state=active]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn("focus-visible:outline-none", className)} {...props} />;
}
