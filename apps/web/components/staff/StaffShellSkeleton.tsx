"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import logo from "@/assets/logo.png";
import logoMark from "@/assets/logo-mark.png";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

// The dashboard's frame in gray while the session is checked (the sign-in cookies live on the API, so the page can only
// ask from the browser). Same boxes as StaffShell, so the real one lands in place without a shift.
export function StaffShellSkeleton() {
  const t = useTranslations("common.ui");
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh" aria-busy role="status">
      <span className="sr-only">{t("loading")}</span>
      <div className="sticky top-0 hidden h-dvh shrink-0 md:block xl:hidden">
        <SidebarSkeleton rail />
      </div>
      <div className="sticky top-0 hidden h-dvh shrink-0 xl:block">
        <SidebarSkeleton rail={false} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-4 md:px-6">
          <Skeleton className="size-10 rounded-lg md:hidden" />
          <Skeleton className="hidden h-10 w-90 rounded-lg md:block" />
          <div className="flex-1" />
          <Skeleton className="size-10 rounded-lg" />
        </header>
        <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 xl:p-8">
          {pathname === "/" ? <OverviewSkeleton /> : <PageSkeleton />}
        </main>
      </div>
    </div>
  );
}

// Four groups of links, roughly the size of a full menu; the real one may have fewer.
const groups = [3, 3, 2, 4];

function SidebarSkeleton({ rail }: { rail: boolean }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-6 border-e border-border bg-surface pt-5 pb-4",
        rail ? "w-18 items-center px-3" : "w-66 px-4",
      )}
    >
      <div className={cn("flex shrink-0 items-center py-0.5", !rail && "ps-2")}>
        {rail ? (
          <Image src={logoMark} alt="" className="h-6.25 w-7" priority />
        ) : (
          <Image src={logo} alt="" className="h-7.75 w-28" priority />
        )}
      </div>

      <div className="flex min-h-0 w-full flex-1 flex-col gap-4 overflow-hidden">
        {groups.map((links, group) => (
          <div key={group} className={cn("flex flex-col gap-0.5", rail && "items-center")}>
            {group > 0 &&
              (rail ? (
                <div className="mb-1 h-px w-8 bg-border" />
              ) : (
                <div className="flex h-5 items-center px-3 pb-1">
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            {Array.from({ length: links }, (_, link) =>
              rail ? (
                <div key={link} className="flex size-10 items-center justify-center">
                  <Skeleton className="size-5" />
                </div>
              ) : (
                <div key={link} className="flex h-10 items-center gap-3 px-3">
                  <Skeleton className="size-5 shrink-0" />
                  <Skeleton
                    className="h-3.5"
                    style={{ width: `${45 + ((group + link) % 3) * 15}%` }}
                  />
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      <div
        className={cn(
          "flex w-full shrink-0 items-center gap-2.5 border-t border-border pt-3",
          rail && "justify-center",
        )}
      >
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {!rail && (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action && <Skeleton className="h-10 w-32 rounded-lg" />}
    </div>
  );
}

function CardSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-5 shadow-xs", className)}>
      <div className="flex h-8 items-center pb-4 box-content">
        <Skeleton className="h-4.5 w-36" />
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-3">
        {Array.from({ length: rows }, (_, row) => (
          <Skeleton key={row} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

// The overview's own layout, since it's where everyone lands.
function OverviewSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="size-7.5 rounded-lg" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="my-1 h-6.5 w-12" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23.75rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
        <CardSkeleton rows={2} />
      </div>
    </>
  );
}

// Any other page: its header and a table-sized card.
function PageSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <CardSkeleton rows={6} />
    </>
  );
}
