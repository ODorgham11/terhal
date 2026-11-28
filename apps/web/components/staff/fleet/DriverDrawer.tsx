"use client";

import { Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { CreateDriver, type Driver } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { officesQuery } from "../queries";
import { kindOf } from "./format";

const optional = (max: number) => z.string().trim().max(max).optional();

// The form's own shape: one "kind" picks internal, freelance or an office's driver.
const DriverForm = z
  .object({
    firstName: CreateDriver.shape.firstName,
    lastName: CreateDriver.shape.lastName,
    phone: CreateDriver.shape.phone,
    licenseNumber: CreateDriver.shape.licenseNumber,
    licenseExpiresAt: CreateDriver.shape.licenseExpiresAt,
    nationalId: optional(30),
    kind: z.enum(["internal", "external", "office"]),
    officeId: z.string(),
    notes: optional(500),
  })
  .refine((driver) => driver.kind !== "office" || driver.officeId !== "", {
    path: ["officeId"],
    message: "Choose the office.",
  });

const blank = (value: string) => value.trim() || undefined;

type Props = {
  // Absent to add a driver.
  driver?: Driver;
  // Adding from an office's page: the office is chosen already.
  officeId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (driver: Driver) => void;
};

export function DriverDrawer({ driver, officeId, open, onOpenChange, onSaved }: Props) {
  const t = useTranslations("staff.fleet.driverForm");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={driver ? t("editTitle") : t("addTitle")}
        description={t("description")}
        className="max-w-xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="driver-form">
              {driver ? t("save") : t("add")}
            </Button>
          </>
        }
      >
        {open && (
          <DriverFields
            driver={driver}
            officeId={officeId}
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

function DriverFields({
  driver,
  officeId,
  onSaved,
}: {
  driver?: Driver;
  officeId?: string;
  onSaved: (driver: Driver) => void;
}) {
  const t = useTranslations("staff.fleet.driverForm");
  const kinds = useTranslations("staff.fleet.kinds");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const offices = useQuery(officesQuery);
  const form = useZodForm(DriverForm, {
    defaultValues: {
      firstName: driver?.firstName ?? "",
      lastName: driver?.lastName ?? "",
      phone: driver?.phone ?? "",
      licenseNumber: driver?.licenseNumber ?? "",
      licenseExpiresAt: driver?.licenseExpiresAt ?? "",
      nationalId: driver?.nationalId ?? undefined,
      kind: driver ? kindOf(driver) : officeId ? "office" : "internal",
      officeId: driver?.office?.id ?? officeId ?? "",
      notes: driver?.notes ?? undefined,
    },
  });
  const kind = form.watch("kind");

  return (
    <Form
      id="driver-form"
      form={form}
      onSubmit={async ({ kind: chosen, officeId: office, nationalId, notes, ...values }) => {
        const json = {
          ...values,
          nationalId: nationalId ?? null,
          notes: notes ?? null,
          isExternal: chosen !== "internal",
          officeId: chosen === "office" ? office : null,
        };
        const saved = driver
          ? await call(staffApi.drivers[":id"].$patch({ param: { id: driver.id }, json }))
          : await call(staffApi.drivers.$post({ json }));
        client.setQueryData(["staff", "driver", saved.id], saved);
        await Promise.all([
          client.invalidateQueries({ queryKey: ["staff", "drivers"] }),
          client.invalidateQueries({ queryKey: ["staff", "office"] }),
        ]);
        toast.success(driver ? t("saved") : t("added"));
        onSaved(saved);
      }}
    >
      <FormError />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="firstName" label={fields("firstName")}>
          <Input autoComplete="off" {...form.register("firstName")} />
        </FormField>
        <FormField name="lastName" label={fields("lastName")}>
          <Input autoComplete="off" {...form.register("lastName")} />
        </FormField>
      </div>
      <FormField name="phone" label={fields("phone")}>
        <Controller
          control={form.control}
          name="phone"
          render={({ field }) => <PhoneInput {...field} autoComplete="off" />}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="licenseNumber" label={fields("licenseNumber")}>
          <Input autoComplete="off" dir="ltr" {...form.register("licenseNumber")} />
        </FormField>
        <FormField name="licenseExpiresAt" label={fields("licenseExpiresAt")}>
          <Input type="date" {...form.register("licenseExpiresAt")} />
        </FormField>
      </div>
      <FormField name="nationalId" label={fields("nationalId")} optional>
        <Input
          autoComplete="off"
          dir="ltr"
          inputMode="numeric"
          {...form.register("nationalId", { setValueAs: blank })}
        />
      </FormField>
      <RadioGroup legend={t("kind")}>
        {(["internal", "external", "office"] as const).map((value) => (
          <Radio
            key={value}
            value={value}
            label={kinds(value)}
            description={t(`kindHints.${value}`)}
            {...form.register("kind")}
          />
        ))}
      </RadioGroup>
      {kind === "office" && (
        <FormField name="officeId" label={fields("office")}>
          <Select placeholder={t("chooseOffice")} {...form.register("officeId")}>
            {offices.data?.data.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField name="notes" label={fields("notes")} optional>
        <Textarea rows={3} {...form.register("notes", { setValueAs: blank })} />
      </FormField>
    </Form>
  );
}
