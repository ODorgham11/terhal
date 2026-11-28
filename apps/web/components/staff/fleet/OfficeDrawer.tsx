"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { CreateOffice, type Office } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { LocationPicker, type PickedLocation } from "../LocationPicker";

const OfficeForm = z.object({
  name: CreateOffice.shape.name,
  contact: CreateOffice.shape.contact,
  phone: CreateOffice.shape.phone,
  email: z.email().optional(),
  address: CreateOffice.shape.address,
  notes: z.string().trim().max(500).optional(),
});

const blank = (value: string) => value.trim() || undefined;

type Props = {
  office?: Office;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (office: Office) => void;
};

export function OfficeDrawer({ office, open, onOpenChange, onSaved }: Props) {
  const t = useTranslations("staff.fleet.officeForm");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={office ? t("editTitle") : t("addTitle")}
        description={t("description")}
        className="max-w-xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="office-form">
              {office ? t("save") : t("add")}
            </Button>
          </>
        }
      >
        {open && (
          <OfficeFields
            office={office}
            onSaved={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function OfficeFields({ office, onSaved }: { office?: Office; onSaved: (office: Office) => void }) {
  const t = useTranslations("staff.fleet.officeForm");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const [location, setLocation] = useState<PickedLocation | null>(office?.location ?? null);
  const form = useZodForm(OfficeForm, {
    defaultValues: {
      name: office?.name ?? "",
      contact: office?.contact ?? "",
      phone: office?.phone ?? "",
      email: office?.email ?? undefined,
      address: office?.address ?? "",
      notes: office?.notes ?? undefined,
    },
  });

  return (
    <Form
      id="office-form"
      form={form}
      onSubmit={async ({ email, notes, ...values }) => {
        const json = {
          ...values,
          email: email ?? null,
          notes: notes ?? null,
          locationId: location?.id ?? null,
        };
        const saved = office
          ? await call(staffApi.offices[":id"].$patch({ param: { id: office.id }, json }))
          : await call(staffApi.offices.$post({ json }));
        await Promise.all([
          client.invalidateQueries({ queryKey: ["staff", "offices"] }),
          client.invalidateQueries({ queryKey: ["staff", "office", saved.id] }),
        ]);
        toast.success(office ? t("saved") : t("added"));
        onSaved(saved);
      }}
    >
      <FormError />
      <FormField name="name" label={fields("officeName")}>
        <Input autoComplete="off" {...form.register("name")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="contact" label={fields("contact")}>
          <Input autoComplete="off" {...form.register("contact")} />
        </FormField>
        <FormField name="phone" label={fields("phone")}>
          <Controller
            control={form.control}
            name="phone"
            render={({ field }) => <PhoneInput {...field} autoComplete="off" />}
          />
        </FormField>
      </div>
      <FormField name="email" label={fields("email")} optional>
        <Input
          type="email"
          autoComplete="off"
          dir="ltr"
          {...form.register("email", { setValueAs: blank })}
        />
      </FormField>
      <FormField name="address" label={fields("address")}>
        <Input autoComplete="off" {...form.register("address")} />
      </FormField>
      <Field label={fields("area")} optional hint={t("areaHint")}>
        <LocationPicker value={location} onChange={setLocation} />
      </Field>
      <FormField name="notes" label={fields("notes")} optional>
        <Textarea rows={3} {...form.register("notes", { setValueAs: blank })} />
      </FormField>
    </Form>
  );
}
