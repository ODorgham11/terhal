import type { ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import logo from "@/assets/logo.png";
import { AuthPanel } from "./AuthPanel";
import { cn } from "@/lib/cn";

type AuthCardProps = {
  title: ReactNode;
  description?: ReactNode;
  // Above the title: an icon badge on the "check your email" and "link expired" pages.
  icon?: ReactNode;
  children?: ReactNode;
};

// The signed-out pages (sign in, password reset, invitations, for staff and admins): a split screen. The form sits in
// a narrow, plain column on the inline start, under the logo in the page's corner; on desktops the inline end is a
// maroon panel with a drawn route and a line about Terhal. No language switcher: the language follows the browser.
export function AuthCard({ title, description, icon, children }: AuthCardProps) {
  const t = useTranslations("staff.auth");

  return (
    <main className="flex min-h-dvh bg-surface lg:p-3">
      <div className="flex min-w-0 flex-1 flex-col px-6 py-6 sm:px-10 lg:px-14">
        <Image src={logo} alt={t("logo")} className="h-8 w-auto self-start" priority />
        <div className="flex flex-1 items-center justify-center py-12">
          <section className="flex w-full max-w-88 flex-col gap-8">
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
        <p className="text-xs text-muted">{t("footer", { year: new Date().getFullYear() })}</p>
      </div>
      <AuthPanel />
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
