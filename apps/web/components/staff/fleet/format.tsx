"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { Driver, Vehicle } from "@terhal/contracts";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { whatsappLink } from "@/lib/whatsapp";
import { useTripDates } from "../trips/format";

// +201001234567 → 0100-123-4567, the way Egyptian numbers are written; other numbers as stored.
export const displayPhone = (phone: string) => {
  const local = /^\+20(\d{10})$/.exec(phone)?.[1];
  return local ? `0${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}` : phone;
};

export function Phone({ phone, className }: { phone: string; className?: string }) {
  return (
    <a
      href={whatsappLink(phone)}
      target="_blank"
      rel="noreferrer"
      dir="ltr"
      className={cn("hover:underline", className)}
    >
      {displayPhone(phone)}
    </a>
  );
}

type Kind = "internal" | "external" | "office";

export const kindOf = (item: Pick<Driver | Vehicle, "isExternal" | "office">): Kind =>
  item.office ? "office" : item.isExternal ? "external" : "internal";

const kindTones = { internal: "primary", external: "accent", office: "info" } as const;

// Ours, a freelancer, or a partner office's.
export function KindBadge({ item }: { item: Pick<Driver | Vehicle, "isExternal" | "office"> }) {
  const t = useTranslations("staff.fleet.kinds");
  const kind = kindOf(item);
  return (
    <Badge tone={kindTones[kind]} dot>
      {t(kind)}
    </Badge>
  );
}

// The ledger balance from the company's side: positive is owed to the driver, negative is owed by them.
export function useBalance() {
  const t = useTranslations("staff.fleet.balance");
  const { price } = useTripDates();
  return (amountOwed: string) => {
    const amount = Number(amountOwed);
    if (amount === 0) return { text: t("settled"), tone: "text-muted" };
    const money = price(Math.abs(amount).toFixed(2));
    return amount > 0
      ? { text: t("owed", { amount: money }), tone: "text-success" }
      : { text: t("owes", { amount: money }), tone: "text-danger" };
  };
}

export function Balance({ amountOwed, className }: { amountOwed: string; className?: string }) {
  const balance = useBalance()(amountOwed);
  return <span className={cn("text-sm font-medium", balance.tone, className)}>{balance.text}</span>;
}

// Days from today (Cairo) to a YYYY-MM-DD date; negative once it's past.
export const daysUntil = (date: string) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
};

export function Licence({ driver }: { driver: Driver }) {
  const t = useTranslations("staff.fleet.licence");
  const date = useCalendarDate();
  if (!driver.licenseExpiresAt) return <span className="text-sm text-muted">{t("none")}</span>;
  const days = daysUntil(driver.licenseExpiresAt);
  const [label, tone] =
    days < 0
      ? [t("expired"), "text-danger"]
      : driver.licenseExpiresSoon
        ? [t("expiresIn", { days }), "text-warning"]
        : [t("valid"), "text-foreground"];
  return (
    <div className="flex flex-col">
      <span className={cn("text-sm font-medium", tone)}>{label}</span>
      <span className="text-xs text-muted">
        {days < 0
          ? date(driver.licenseExpiresAt)
          : t("until", { date: date(driver.licenseExpiresAt) })}
      </span>
    </div>
  );
}

// A calendar date (YYYY-MM-DD) with its year: "Mar 14, 2027". Read as UTC so no time zone moves it a day.
export function useCalendarDate() {
  const format = useFormatter();
  return (date: string) =>
    format.dateTime(new Date(`${date}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
}
