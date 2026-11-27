"use client";

import { useTranslations } from "next-intl";
import { ProposePrice, type Trip } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { useRoute } from "../format";
import { useTripChanged } from "./cache";

type Props = {
  trip: Trip;
  // Saving to the price list needs `pricing`.
  canSaveToPricing: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// A price for a trip booked on request. The booker accepts or declines it, unless staff booked the trip.
export function ProposePriceDialog({ trip, canSaveToPricing, open, onOpenChange }: Props) {
  const t = useTranslations("staff.trips.detail.proposePrice");
  const actions = useTranslations("staff.trips.detail");
  const fields = useTranslations("common.fields");
  const route = useRoute();
  const changed = useTripChanged();
  const form = useZodForm(ProposePrice, {
    defaultValues: { totalPrice: trip.totalPrice ?? "", note: undefined, saveToPricing: false },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent title={t("title")} description={t("description", { route: route(trip) })}>
        <Form
          form={form}
          onSubmit={async (json) => {
            await call(staffApi.trips[":id"].price.$post({ param: { id: trip.id }, json }));
            await changed(trip.id);
            onOpenChange(false);
          }}
        >
          <FormError />
          <FormField name="totalPrice" label={fields("totalPrice")}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              startAdornment={<span className="text-xs font-medium">EGP</span>}
              className="ps-12"
              {...form.register("totalPrice")}
            />
          </FormField>
          <FormField name="note" label={fields("note")} optional hint={t("noteHint")}>
            <Textarea
              rows={3}
              {...form.register("note", {
                setValueAs: (value: string) => value.trim() || undefined,
              })}
            />
          </FormField>
          {canSaveToPricing && (
            <Checkbox
              label={t("saveToPricing")}
              description={t("saveToPricingHint")}
              {...form.register("saveToPricing")}
            />
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{actions("cancel")}</Button>
            </DialogClose>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
