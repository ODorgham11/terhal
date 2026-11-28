"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { IconPencil, IconPlus } from "@tabler/icons-react";
import type { Brand } from "@terhal/contracts";
import logo from "@/assets/logo.png";
import { RequireStaff } from "@/components/session/RequireSession";
import { BrandDrawer } from "@/components/staff/brands/BrandDrawer";
import { BrandMark } from "@/components/staff/brands/BrandMark";
import { displayPhone } from "@/components/staff/fleet/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { AutoHeight, fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function BrandsPage() {
  return <RequireStaff permission="team">{() => <Brands />}</RequireStaff>;
}

type Tab = "false" | "true";

function Brands() {
  const t = useTranslations("staff.brands");
  const list = useTranslations("staff.list");
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useState<Tab>("false");
  const [editing, setEditing] = useState<Brand | "new" | null>(null);
  const brands = useQuery({
    queryKey: ["staff", "brands", tab],
    queryFn: () => call(staffApi.brands.$get({ query: { archived: tab } })),
  });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setEditing("new")}>
            <IconPlus aria-hidden className="size-5" stroke={1.75} />
            {t("add")}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="false">{list("active")}</TabsTrigger>
          <TabsTrigger value="true">{list("archived")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <AutoHeight>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {tab === "false" && <BuiltIn />}
          {brands.isPending ? (
            <BrandCardLoading />
          ) : brands.isError ? (
            <motion.p {...fade} className="py-10 text-center text-sm text-danger lg:col-span-2">
              {errorMessage(brands.error)}
            </motion.p>
          ) : brands.data.data.length === 0 && tab === "true" ? (
            <motion.p {...fade} className="py-10 text-center text-sm text-muted lg:col-span-2">
              {t("noArchived")}
            </motion.p>
          ) : (
            brands.data.data.map((brand) => (
              <BrandCard key={brand.id} brand={brand} onEdit={() => setEditing(brand)} />
            ))
          )}
        </div>
      </AutoHeight>
      <BrandDrawer
        brand={editing === "new" || editing === null ? undefined : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function Card({
  mark,
  name,
  nameAr,
  badge,
  action,
  rows,
  note,
  muted,
}: {
  mark: ReactNode;
  name: string;
  nameAr: string;
  badge?: ReactNode;
  action?: ReactNode;
  rows: [string, ReactNode][];
  note: string;
  muted?: boolean;
}) {
  return (
    <motion.article
      {...fade}
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs",
        muted && "opacity-75",
      )}
    >
      <header className="flex items-start gap-4 border-b border-border pb-4">
        <span className="grid h-14 w-24 shrink-0 place-items-center rounded-xl bg-surface-muted">
          {mark}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-foreground">{name}</span>
            {badge}
          </span>
          <span className="text-sm text-muted" dir="rtl">
            {nameAr}
          </span>
        </div>
        {action}
      </header>
      <dl className="flex flex-col gap-3 text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
          >
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted">{note}</p>
    </motion.article>
  );
}

// A brand's card in gray, so the grid doesn't move when they arrive.
function BrandCardLoading() {
  const t = useTranslations("common.ui");
  return (
    <motion.div
      {...fade}
      role="status"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
    >
      <span className="sr-only">{t("loading")}</span>
      <div className="flex items-start gap-4 border-b border-border pb-4">
        <Skeleton className="h-14 w-24 shrink-0 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <Skeleton className="h-8 w-18 rounded-lg" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className={cn("h-4", row % 2 ? "w-32" : "w-48")} />
          </div>
        ))}
      </div>
      <Skeleton className="h-3 w-3/4" />
    </motion.div>
  );
}

// Terhal itself: not a row in the API, always there, never edited.
function BuiltIn() {
  const t = useTranslations("staff.brands");
  return (
    <Card
      mark={<Image src={logo} alt="" className="h-7 w-auto" />}
      name="Terhal"
      nameAr="ترحال"
      badge={<Badge tone="neutral">{t("builtIn")}</Badge>}
      rows={[
        [t("rows.from"), t("appSender")],
        [t("rows.replyTo"), t("sameAsSender")],
        [t("rows.phone"), t("notShown")],
        [
          t("rows.website"),
          <span key="w" dir="ltr">
            terhal.co
          </span>,
        ],
      ]}
      note={t("builtInNote")}
    />
  );
}

function BrandCard({ brand, onEdit }: { brand: Brand; onEdit: () => void }) {
  const t = useTranslations("staff.brands");
  const common = useTranslations("staff.common");
  return (
    <Card
      mark={<BrandMark name={brand.nameEn} />}
      name={brand.nameEn}
      nameAr={brand.nameAr}
      muted={brand.archivedAt !== null}
      badge={
        brand.archivedAt ? (
          <Badge tone="neutral">{t("archived")}</Badge>
        ) : (
          brand.isDefault && <Badge tone="primary">{t("default")}</Badge>
        )
      }
      action={
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <IconPencil aria-hidden className="size-4" stroke={1.75} />
          {common("edit")}
        </Button>
      }
      rows={[
        [
          t("rows.from"),
          <span key="f" dir="ltr">
            {brand.nameEn} &lt;{brand.senderEmail}&gt;
          </span>,
        ],
        [
          t("rows.replyTo"),
          brand.replyTo ? (
            <span key="r" dir="ltr">
              {brand.replyTo}
            </span>
          ) : (
            t("sameAsSender")
          ),
        ],
        [
          t("rows.phone"),
          brand.phone ? (
            <span key="p" dir="ltr">
              {displayPhone(brand.phone)}
            </span>
          ) : (
            t("notShown")
          ),
        ],
        [
          t("rows.website"),
          brand.website ? (
            <span key="w" dir="ltr">
              {brand.website}
            </span>
          ) : (
            "—"
          ),
        ],
      ]}
      note={brand.isDefault ? t("defaultNote") : t("note")}
    />
  );
}
