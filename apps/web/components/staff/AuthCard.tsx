import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import logo from "@/assets/logo.png";
import { cn } from "@/lib/cn";

type AuthCardProps = {
  title: ReactNode;
  description?: ReactNode;
  // Above the title: an icon badge on the "check your email" and "link expired" pages.
  icon?: ReactNode;
  children?: ReactNode;
};

// The signed-out pages (sign in, password reset, invitations, for staff and admins): no card, just a narrow column on a
// white page, the logo over the title and the form, and the copyright at the foot. The language follows the browser's
// cookie; there's no switcher here.
export function AuthCard({ title, description, icon, children }: AuthCardProps) {
  const t = useTranslations("staff.auth");

  return (
    <main className="flex min-h-dvh flex-col bg-surface px-6">
      <div className="flex flex-1 items-center justify-center py-16">
        <section className="flex w-full max-w-88 flex-col gap-8">
          <Image src={logo} alt={t("logo")} className="h-8 w-auto self-start" priority />
          <header className="flex flex-col gap-1.5">
            {icon && <div className="mb-3">{icon}</div>}
            <h1 className="text-[1.625rem] leading-8 font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {description && <p className="text-sm text-muted">{description}</p>}
          </header>
          {children && <div className="flex flex-col gap-5">{children}</div>}
        </section>
      </div>
      <p className="pb-6 text-center text-xs text-muted">
        {t("footer", { year: new Date().getFullYear() })}
      </p>
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
