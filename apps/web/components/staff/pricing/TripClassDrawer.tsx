"use client";

import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { StaffTripClass, TripClass } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { WholeNumberInput } from "@/components/ui/WholeNumberInput";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { call, staffApi } from "@/lib/api";
import { toLatinDigits } from "@/lib/digits";
import { useZodForm } from "@/lib/forms/useZodForm";

const Name = z.string().trim().min(2).max(50);
const Description = z.string().trim().max(500);
const ClassForm = z.object({
  nameEn: Name,
  nameAr: Name,
  descriptionEn: Description,
  descriptionAr: Description,
  sortOrder: z.number().int().min(0).max(1000),
});

type Props = {
  tripClass?: StaffTripClass;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Add a class, or edit one; an edited class can be archived from here too.
export function TripClassDrawer({ tripClass, open, onOpenChange }: Props) {
  const t = useTranslations("staff.tripClasses.form");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={tripClass ? t("editTitle") : t("addTitle")}
        description={t("description")}
        className="max-w-xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="trip-class-form">
              {tripClass ? t("save") : t("add")}
            </Button>
          </>
        }
      >
        {open && <ClassFields tripClass={tripClass} onDone={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  );
}

function ClassFields({ tripClass, onDone }: { tripClass?: StaffTripClass; onDone: () => void }) {
  const t = useTranslations("staff.tripClasses.form");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const form = useZodForm(ClassForm, {
    defaultValues: {
      nameEn: tripClass?.nameEn ?? "",
      nameAr: tripClass?.nameAr ?? "",
      descriptionEn: tripClass?.descriptionEn ?? "",
      descriptionAr: tripClass?.descriptionAr ?? "",
      sortOrder: tripClass?.sortOrder ?? 0,
    },
  });
  const refresh = () => client.invalidateQueries({ queryKey: ["staff", "trip-classes"] });

  const archive = async (target: TripClass) => {
    const action = target.archivedAt ? "restore" : "archive";
    await call(staffApi["trip-classes"][":id"][action].$post({ param: { id: target.id } }));
    await refresh();
    toast.success(target.archivedAt ? t("restored") : t("archived"));
    onDone();
  };

  return (
    <Form
      id="trip-class-form"
      form={form}
      onSubmit={async (values) => {
        const json = {
          ...values,
          descriptionEn: values.descriptionEn || null,
          descriptionAr: values.descriptionAr || null,
        };
        if (tripClass)
          await call(staffApi["trip-classes"][":id"].$patch({ param: { id: tripClass.id }, json }));
        else await call(staffApi["trip-classes"].$post({ json }));
        await refresh();
        toast.success(tripClass ? t("saved") : t("added"));
        onDone();
      }}
    >
      <FormError />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="nameEn" label={fields("nameEn")}>
          <Input autoComplete="off" dir="ltr" {...form.register("nameEn")} />
        </FormField>
        <FormField name="nameAr" label={fields("nameAr")}>
          <Input autoComplete="off" dir="rtl" {...form.register("nameAr")} />
        </FormField>
      </div>
      <FormField name="descriptionEn" label={fields("descriptionEn")} optional>
        <Textarea rows={3} dir="ltr" {...form.register("descriptionEn")} />
      </FormField>
      <FormField name="descriptionAr" label={fields("descriptionAr")} optional>
        <Textarea rows={3} dir="rtl" {...form.register("descriptionAr")} />
      </FormField>
      <FormField name="sortOrder" label={fields("sortOrder")} hint={t("sortHint")}>
        <WholeNumberInput
          {...form.register("sortOrder", {
            setValueAs: (value: string | number) => Number(toLatinDigits(String(value)) || 0),
          })}
        />
      </FormField>
      {tripClass && (
        <section className="flex flex-col items-start gap-2 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {tripClass.archivedAt ? t("restoreTitle") : t("archiveTitle")}
          </h3>
          <p className="text-sm text-muted">
            {tripClass.archivedAt
              ? t("restoreHint")
              : t("archiveHint", { count: tripClass.prices })}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void archive(tripClass)}
          >
            {tripClass.archivedAt ? t("restore") : t("archive")}
          </Button>
        </section>
      )}
    </Form>
  );
}
