"use client";

import { Controller } from "react-hook-form";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { z } from "zod";
import { CreateVehicle, carBodies, type Vehicle } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { WholeNumberInput } from "@/components/ui/WholeNumberInput";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { officesQuery } from "../queries";
import { Segmented } from "../Segmented";
import { kindOf } from "./format";

const VehicleForm = z
  .object({
    make: CreateVehicle.shape.make,
    model: CreateVehicle.shape.model,
    year: z.number().int().min(1980).max(2100).optional(),
    plateNumber: CreateVehicle.shape.plateNumber,
    color: CreateVehicle.shape.color,
    body: CreateVehicle.shape.body,
    kind: z.enum(["internal", "external", "office"]),
    officeId: z.string(),
  })
  .refine((vehicle) => vehicle.kind !== "office" || vehicle.officeId !== "", {
    path: ["officeId"],
    message: "Choose the office.",
  });

type Props = {
  vehicle?: Vehicle;
  // Adding from an office's page: the office is chosen already.
  officeId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (vehicle: Vehicle) => void;
};

export function VehicleDrawer({ vehicle, officeId, open, onOpenChange, onSaved }: Props) {
  const t = useTranslations("staff.fleet.vehicleForm");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={vehicle ? t("editTitle") : t("addTitle")}
        description={t("description")}
        className="max-w-xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="vehicle-form">
              {vehicle ? t("save") : t("add")}
            </Button>
          </>
        }
      >
        {open && (
          <VehicleFields
            vehicle={vehicle}
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

function VehicleFields({
  vehicle,
  officeId,
  onSaved,
}: {
  vehicle?: Vehicle;
  officeId?: string;
  onSaved: (vehicle: Vehicle) => void;
}) {
  const t = useTranslations("staff.fleet.vehicleForm");
  const kinds = useTranslations("staff.fleet.kinds");
  const cars = useTranslations("staff.trips.car");
  const fields = useTranslations("common.fields");
  const client = useQueryClient();
  const offices = useQuery(officesQuery);
  const form = useZodForm(VehicleForm, {
    defaultValues: {
      make: vehicle?.make ?? "",
      model: vehicle?.model ?? "",
      year: vehicle?.year ?? undefined,
      plateNumber: vehicle?.plateNumber ?? "",
      color: vehicle?.color ?? "",
      body: vehicle?.body ?? "SEDAN",
      kind: vehicle ? kindOf(vehicle) : officeId ? "office" : "internal",
      officeId: vehicle?.office?.id ?? officeId ?? "",
    },
  });
  const kind = form.watch("kind");

  return (
    <Form
      id="vehicle-form"
      className="gap-6"
      form={form}
      onSubmit={async ({ kind: chosen, officeId: office, year, ...values }) => {
        const json = {
          ...values,
          year: year ?? null,
          isExternal: chosen !== "internal",
          officeId: chosen === "office" ? office : null,
        };
        const saved = vehicle
          ? await call(staffApi.vehicles[":id"].$patch({ param: { id: vehicle.id }, json }))
          : await call(staffApi.vehicles.$post({ json }));
        client.setQueryData(["staff", "vehicle", saved.id], saved);
        await Promise.all([
          client.invalidateQueries({ queryKey: ["staff", "vehicles"] }),
          client.invalidateQueries({ queryKey: ["staff", "office"] }),
        ]);
        toast.success(vehicle ? t("saved") : t("added"));
        onSaved(saved);
      }}
    >
      <FormError />
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
        <FormField name="make" label={fields("make")}>
          <Input autoComplete="off" placeholder="Toyota" {...form.register("make")} />
        </FormField>
        <FormField name="model" label={fields("model")}>
          <Input autoComplete="off" placeholder="Corolla" {...form.register("model")} />
        </FormField>
      </div>
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-3">
        <FormField name="year" label={fields("year")} optional>
          <WholeNumberInput
            {...form.register("year", {
              setValueAs: (value: string | number) =>
                value === "" || value === undefined ? undefined : Number(value),
            })}
          />
        </FormField>
        <FormField name="plateNumber" label={fields("plateNumber")}>
          <Input autoComplete="off" dir="ltr" {...form.register("plateNumber")} />
        </FormField>
        <FormField name="color" label={fields("color")}>
          <Input autoComplete="off" {...form.register("color")} />
        </FormField>
      </div>
      <FormField name="body" label={fields("body")} hint={t("bodyHint")}>
        {/* The same picker as a trip's car, so a vehicle's body and a trip's read alike. */}
        <Controller
          control={form.control}
          name="body"
          render={({ field }) => (
            <Segmented
              label={fields("body")}
              value={field.value}
              onChange={field.onChange}
              options={carBodies.map((body) => ({ value: body, label: cars(body) }))}
            />
          )}
        />
      </FormField>
      <RadioGroup legend={t("kind")}>
        {(["internal", "external", "office"] as const).map((value) => (
          <Radio key={value} value={value} label={kinds(value)} {...form.register("kind")} />
        ))}
      </RadioGroup>
      {/* Opens under the choice when it's an office's vehicle, and closes again when it isn't. */}
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
    </Form>
  );
}
