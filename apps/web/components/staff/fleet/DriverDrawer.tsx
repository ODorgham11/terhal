"use client";

import { Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { z } from "zod";
import { CreateDriver, type Driver } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { fade } from "@/components/ui/Motion";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { WholeNumberInput } from "@/components/ui/WholeNumberInput";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { officesQuery } from "../queries";
import { daysUntil, kindOf } from "./format";

const optional = (max: number) => z.string().trim().max(max).optional();

// The form's own shape: one "kind" picks internal, freelance or an office's driver.
const DriverForm = z
  .object({
    firstName: CreateDriver.shape.firstName,
    lastName: CreateDriver.shape.lastName,
    phone: CreateDriver.shape.phone,
    licenseNumber: CreateDriver.shape.licenseNumber,
    licenseExpiresAt: CreateDriver.shape.licenseExpiresAt,
    nationalId: CreateDriver.shape.nationalId,
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
  const expiry = form.watch("licenseExpiresAt");
  // Saving a driver whose licence has run out is allowed (it may be renewed on paper already), but said.
  const expired = /^\d{4}-\d{2}-\d{2}$/.test(expiry ?? "") && daysUntil(expiry) < 0;

  return (
    <Form
      id="driver-form"
      form={form}
      className="gap-6"
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
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
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
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
        <FormField name="licenseNumber" label={fields("licenseNumber")}>
          <Input autoComplete="off" dir="ltr" {...form.register("licenseNumber")} />
        </FormField>
        <FormField name="licenseExpiresAt" label={fields("licenseExpiresAt")}>
          <Controller
            control={form.control}
            name="licenseExpiresAt"
            render={({ field }) => (
              <DatePicker value={field.value ?? ""} onChange={field.onChange} />
            )}
          />
        </FormField>
      </div>
      <AnimatePresence initial={false}>
        {expired && (
          <motion.div
            key="expired"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={fade.transition}
            className="-mt-6 overflow-hidden"
          >
            <div className="pt-3">
              <Alert tone="warning" title={t("licenceExpired")} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <FormField name="nationalId" label={fields("nationalId")} optional>
        <WholeNumberInput
          dir="ltr"
          maxLength={14}
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
      {/* Opens under the choice when it's an office's driver, and closes again when it isn't. */}
      <AnimatePresence initial={false}>
        {kind === "office" && (
          <motion.div
            key="office"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={fade.transition}
            className="-mt-6 overflow-hidden"
          >
            <div className="pt-6">
              <FormField name="officeId" label={fields("office")}>
                {offices.data ? (
                  <Select placeholder={t("chooseOffice")} {...form.register("officeId")}>
                    {offices.data.data.map((office) => (
                      <option key={office.id} value={office.id}>
                        {office.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Skeleton className="h-10 w-full rounded-lg" />
                )}
              </FormField>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <FormField name="notes" label={fields("notes")} optional>
        <Textarea rows={3} {...form.register("notes", { setValueAs: blank })} />
      </FormField>
    </Form>
  );
}
