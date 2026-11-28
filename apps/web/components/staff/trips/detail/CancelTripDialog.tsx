"use client";

import { useTranslations } from "next-intl";
import { CancelTrip, cancelReasons, type Trip } from "@terhal/contracts";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Form, FormError, FormField } from "@/components/ui/Form";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { Textarea } from "@/components/ui/Textarea";
import { call, staffApi } from "@/lib/api";
import { useZodForm } from "@/lib/forms/useZodForm";
import { useTripChanged } from "./cache";

type Props = { trip: Trip; open: boolean; onOpenChange: (open: boolean) => void };

export function CancelTripDialog({ trip, open, onOpenChange }: Props) {
  const t = useTranslations("staff.trips.detail.cancelTrip");
  const fields = useTranslations("common.fields");
  const changed = useTripChanged();
  const form = useZodForm(CancelTrip, {
    defaultValues: { reason: "CUSTOMER_REQUEST", note: undefined },
  });
  const other = form.watch("reason") === "OTHER";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent title={t("title", { code: trip.code })} description={t("description")}>
        <Form
          form={form}
          onSubmit={async (json) => {
            await call(staffApi.trips[":id"].cancel.$post({ param: { id: trip.id }, json }));
            await changed(trip.id);
            onOpenChange(false);
          }}
        >
          <FormError />
          <RadioGroup legend={t("reason")} error={form.formState.errors.reason?.message}>
            {cancelReasons.map((reason) => (
              <Radio
                key={reason}
                value={reason}
                label={t(`reasons.${reason}`)}
                {...form.register("reason")}
              />
            ))}
          </RadioGroup>
          <FormField name="note" label={fields("note")} optional={!other}>
            <Textarea
              rows={3}
              {...form.register("note", {
                setValueAs: (value: string) => value.trim() || undefined,
              })}
            />
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("keep")}</Button>
            </DialogClose>
            <Button type="submit" variant="danger" loading={form.formState.isSubmitting}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
