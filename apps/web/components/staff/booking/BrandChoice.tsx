"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import logoMark from "@/assets/logo-mark.png";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { BrandMark } from "../brands/BrandMark";

export const brandsQuery = {
  queryKey: ["staff", "brands", "false"],
  queryFn: () => call(staffApi.brands.$get({ query: { archived: "false" } })),
  staleTime: 5 * 60_000,
};

type Props = { value: string | null; onChange: (brandId: string | null) => void };

// Terhal (null) or one of the live brands, as radio cards.
export function BrandChoice({ value, onChange }: Props) {
  const t = useTranslations("staff.booking.brand");
  const brands = useQuery(brandsQuery);
  const options = [
    {
      id: null,
      name: "Terhal",
      sender: t("appSender"),
      mark: <Image src={logoMark} alt="" className="h-5 w-auto" />,
    },
    ...(brands.data?.data ?? []).map((brand) => ({
      id: brand.id,
      name: brand.nameEn,
      sender: brand.senderEmail,
      mark: <BrandMark name={brand.nameEn} className="size-8" />,
    })),
  ];

  return (
    <div role="radiogroup" aria-label={t("label")} className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id ?? "terhal"}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              checked ? "border-primary bg-primary-soft/50" : "border-border hover:bg-hover",
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted">
              {option.mark}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{option.name}</span>
              <span className="truncate text-xs text-muted" dir="ltr">
                {option.sender}
              </span>
            </span>
            <span
              aria-hidden
              className={cn(
                "grid size-4.5 shrink-0 place-items-center rounded-full border-2",
                checked ? "border-primary" : "border-input",
              )}
            >
              {checked && <span className="size-2 rounded-full bg-primary" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
