import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import logo from "@/assets/logo.png";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { cn } from "@/lib/cn";

type AuthCardProps = {
  title: ReactNode;
  description?: ReactNode;
  // Above the title: an icon badge on the "check your email" and "link expired" cards.
  icon?: ReactNode;
  children?: ReactNode;
};

// The signed-out pages (sign in, password reset, invitation): the logo over one card, centred on the page.
export function AuthCard({ title, description, icon, children }: AuthCardProps) {
  const t = useTranslations("staff.auth");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Image src={logo} alt={t("logo")} className="h-10.25 w-37.5" priority />
      <section className="flex w-full max-w-105 flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-xs sm:p-8">
        <header className="flex flex-col gap-1.5">
          {icon}
          <h1 className={cn("text-2xl font-semibold text-foreground", Boolean(icon) && "mt-1.5")}>
            {title}
          </h1>
          {description && <p className="text-sm text-muted">{description}</p>}
        </header>
        {children}
      </section>
      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-muted">{t("footer", { year: new Date().getFullYear() })}</p>
        <LocaleSwitcher className="h-8 text-xs" />
      </div>
    </main>
  );
}

// The round badge above an AuthCard's title.
export function AuthIcon({ tone, children }: { tone: "primary" | "warning"; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 items-center justify-center rounded-full",
        tone === "primary" ? "bg-primary-soft text-primary" : "bg-warning-soft text-warning",
      )}
    >
      {children}
    </span>
  );
}
