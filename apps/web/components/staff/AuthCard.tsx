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
      <BrandPanel />
    </main>
  );
}

// The panel beside the form: a route from pickup to drop-off, drawn like the trip timeline inside the app, and a line
// about what Terhal is for.
function BrandPanel() {
  const t = useTranslations("staff.auth.panel");
  return (
    <aside className="relative hidden w-[42%] max-w-160 shrink-0 flex-col justify-end overflow-hidden rounded-2xl bg-primary p-12 text-primary-foreground lg:flex">
      <svg
        aria-hidden
        viewBox="0 0 520 520"
        fill="none"
        className="absolute -end-10 -top-6 w-[115%] max-w-none rtl:-scale-x-100"
      >
        {/* The road, wide and faint, with its dashed centre line. */}
        <path
          d="M-20 470 C 120 430, 150 300, 250 260 S 420 210, 470 60"
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth="56"
          strokeLinecap="round"
        />
        <path
          d="M-20 470 C 120 430, 150 300, 250 260 S 420 210, 470 60"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2"
          strokeDasharray="10 12"
          strokeLinecap="round"
        />
        {/* Pickup and drop-off: a hollow ring and a filled stop, as on a trip's route. */}
        <circle
          cx="96"
          cy="414"
          r="13"
          fill="var(--primary)"
          stroke="var(--accent)"
          strokeWidth="5"
        />
        <circle cx="440" cy="118" r="14" fill="var(--accent)" />
        <circle
          cx="440"
          cy="118"
          r="26"
          stroke="var(--accent)"
          strokeOpacity="0.35"
          strokeWidth="2"
        />
      </svg>
      <div className="relative flex max-w-sm flex-col gap-3">
        <p className="text-[2.25rem] leading-[1.1] font-semibold tracking-tight">{t("title")}</p>
        <p className="text-sm text-primary-foreground/75">{t("body")}</p>
      </div>
    </aside>
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
