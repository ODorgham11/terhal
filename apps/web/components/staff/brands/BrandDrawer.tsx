"use client";

import { Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { CreateBrand, type Brand } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { displayPhone } from "../fleet/format";
import { BrandMark } from "./BrandMark";

const BrandForm = z.object({
  nameEn: CreateBrand.shape.nameEn,
  nameAr: CreateBrand.shape.nameAr,
  senderEmail: CreateBrand.shape.senderEmail,
  replyTo: z.string().trim(),
  phone: z.string().trim(),
  website: z.string().trim(),
  isDefault: z.boolean(),
});
type BrandForm = z.infer<typeof BrandForm>;

type Props = { brand?: Brand; open: boolean; onOpenChange: (open: boolean) => void };

export function BrandDrawer({ brand, open, onOpenChange }: Props) {
  const t = useTranslations("staff.brands.form");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={brand ? t("editTitle") : t("addTitle")}
        description={t("description")}
        className="max-w-xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="brand-form">
              {brand ? t("save") : t("add")}
            </Button>
          </>
        }
      >
        {open && <BrandFields brand={brand} onDone={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  );
}

function BrandFields({ brand, onDone }: { brand?: Brand; onDone: () => void }) {
  const t = useTranslations("staff.brands.form");
  const client = useQueryClient();
  const form = useZodForm(BrandForm, {
    defaultValues: {
      nameEn: brand?.nameEn ?? "",
      nameAr: brand?.nameAr ?? "",
      senderEmail: brand?.senderEmail ?? "",
      replyTo: brand?.replyTo ?? "",
      phone: brand?.phone ?? "",
      website: brand?.website ?? "",
      isDefault: brand?.isDefault ?? false,
    },
  });
  const values = form.watch();
  const refresh = () => client.invalidateQueries({ queryKey: ["staff", "brands"] });

  const archive = async (target: Brand) => {
    const action = target.archivedAt ? "restore" : "archive";
    await call(staffApi.brands[":id"][action].$post({ param: { id: target.id } }));
    await refresh();
    toast.success(target.archivedAt ? t("restored") : t("archived"));
    onDone();
  };

  return (
    <Form
      id="brand-form"
      form={form}
      onSubmit={async (submitted: BrandForm) => {
        const json = {
          ...submitted,
          replyTo: submitted.replyTo || null,
          phone: submitted.phone || null,
          website: submitted.website || null,
        };
        if (brand) await call(staffApi.brands[":id"].$patch({ param: { id: brand.id }, json }));
        else await call(staffApi.brands.$post({ json }));
        await refresh();
        toast.success(brand ? t("saved") : t("added"));
        onDone();
      }}
    >
      <FormError />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="nameEn" label={t("nameEn")}>
          <Input dir="ltr" autoComplete="off" {...form.register("nameEn")} />
        </FormField>
        <FormField name="nameAr" label={t("nameAr")}>
          <Input dir="rtl" autoComplete="off" {...form.register("nameAr")} />
        </FormField>
        <FormField name="senderEmail" label={t("senderEmail")} hint={t("senderHint")}>
          <Input type="email" dir="ltr" autoComplete="off" {...form.register("senderEmail")} />
        </FormField>
        <FormField name="replyTo" label={t("replyTo")} optional hint={t("replyToHint")}>
          <Input type="email" dir="ltr" autoComplete="off" {...form.register("replyTo")} />
        </FormField>
        <FormField name="phone" label={t("phone")} optional>
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => <PhoneInput {...field} autoComplete="off" />}
          />
        </FormField>
        <FormField name="website" label={t("website")} optional>
          <Input
            dir="ltr"
            autoComplete="off"
            placeholder="alexlimousine.com"
            {...form.register("website")}
          />
        </FormField>
      </div>
      <Switch
        label={t("isDefault")}
        description={t("isDefaultHint")}
        {...form.register("isDefault")}
      />

      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">{t("preview")}</p>
        <div className="overflow-hidden rounded-xl border border-border">
          <p className="truncate bg-surface-muted px-4 py-2 text-xs text-muted" dir="ltr">
            {t("from")}: {values.nameEn || t("namePlaceholder")} &lt;{values.senderEmail || "…"}&gt;
          </p>
          <div className="flex flex-col gap-2 p-4">
            <BrandMark name={values.nameEn || "?"} />
            <p className="text-base font-semibold text-foreground">{t("previewTitle")}</p>
            <p className="text-sm text-foreground">{t("previewBody")}</p>
            <p className="text-xs text-muted">
              {[values.nameEn, values.phone && displayPhone(values.phone), values.website]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-primary-soft/60 p-4 text-sm text-foreground">
          {t("previewWhatsApp", { name: values.nameEn || t("namePlaceholder") })}
          <br />—{" "}
          {[values.nameEn, values.phone && displayPhone(values.phone)].filter(Boolean).join(" · ")}
        </div>
      </section>

      {brand && (
        <section className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {brand.archivedAt ? t("restoreTitle") : t("archiveTitle")}
          </h3>
          <p className="text-sm text-muted">
            {brand.archivedAt ? t("restoreHint") : t("archiveHint")}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void archive(brand)}>
            {brand.archivedAt ? t("restore") : t("archive")}
          </Button>
        </section>
      )}
    </Form>
  );
}
