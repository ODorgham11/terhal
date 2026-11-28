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
  // "split" (the staff dashboard): the form on the inline start and the animated route panel beside it on desktops.
  // "centered" (the admin panel): no panel, everything in one column in the middle of the page.
  layout?: "split" | "centered";
  children?: ReactNode;
};

// The signed-out pages (sign in, password reset, invitations, for staff and admins). A plain, narrow column with the
// logo, the title and the form, and the copyright at the foot; on the staff dashboard, a maroon panel with a drawn
// route beside it. No language switcher: the language follows the browser.
export function AuthCard({ title, description, icon, layout = "split", children }: AuthCardProps) {
  const t = useTranslations("staff.auth");
  const centered = layout === "centered";

  return (
    <main className={cn("flex min-h-dvh bg-surface", !centered && "lg:p-3")}>
      <div className="flex min-w-0 flex-1 flex-col px-6 py-6 sm:px-10 lg:px-14">
        {!centered && (
          <Image src={logo} alt={t("logo")} className="h-8 w-auto self-start" priority />
        )}
        <div className="flex flex-1 items-center justify-center py-12">
          <section className="flex w-full max-w-88 flex-col gap-8">
            {centered && (
              <Image src={logo} alt={t("logo")} className="h-9 w-auto self-center" priority />
            )}
            <header className={cn("flex flex-col gap-1.5", centered && "items-center text-center")}>
              {icon && <div className="mb-3">{icon}</div>}
              <h1 className="text-[1.625rem] leading-8 font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {description && <p className="text-sm text-muted">{description}</p>}
            </header>
            {children && <div className="flex flex-col gap-5">{children}</div>}
          </section>
        </div>
        <p className={cn("text-xs text-muted", centered && "text-center")}>
          {t("footer", { year: new Date().getFullYear() })}
        </p>
      </div>
      {!centered && <AuthPanel />}
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
