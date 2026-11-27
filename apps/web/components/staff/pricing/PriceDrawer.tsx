"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { carBodies, type CarBody } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { toLatinDigits } from "@/lib/digits";
import { LocationPicker, type PickedLocation } from "../LocationPicker";
import { tripClassesQuery } from "../queries";
import { useLocalName } from "../trips/format";

export const PRICE = /^\d{1,7}(\.\d{1,2})?$/;

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

// A fixed price for a route, class and car; optionally the way back too.
export function PriceDrawer({ open, onOpenChange }: Props) {
  const t = useTranslations("staff.pricing.add");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("title")} description={t("description")} className="max-w-lg">
        {open && <PriceFields onDone={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  );
}

function PriceFields({ onDone }: { onDone: () => void }) {
  const t = useTranslations("staff.pricing.add");
  const cars = useTranslations("staff.trips.car");
  const errorMessage = useErrorMessage();
  const name = useLocalName();
  const client = useQueryClient();
  const classes = useQuery(tripClassesQuery);
  const [from, setFrom] = useState<PickedLocation | null>(null);
  const [to, setTo] = useState<PickedLocation | null>(null);
  const [classId, setClassId] = useState("");
  const [car, setCar] = useState<CarBody>("SEDAN");
  const [price, setPrice] = useState("");
  const [bothWays, setBothWays] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    from && to && from.id !== to.id && classId && PRICE.test(price) && Number(price) > 0;

  const save = async () => {
    if (!from || !to) return;
    setBusy(true);
    setError(null);
    try {
      const created = await call(
        staffApi.pricing.$post({
          json: { fromId: from.id, toId: to.id, classId, car, price, bothWays },
        }),
      );
      await client.invalidateQueries({ queryKey: ["staff", "pricing"] });
      toast.success(t("added", { count: created.data.length }));
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      <Field label={t("from")}>
        <LocationPicker value={from} onChange={setFrom} />
      </Field>
      <Field label={t("to")}>
        <LocationPicker value={to} onChange={setTo} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("class")}>
          <Select
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            placeholder={t("chooseClass")}
          >
            {classes.data?.data.map((tripClass) => (
              <option key={tripClass.id} value={tripClass.id}>
                {name(tripClass)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("car")}>
          <Select value={car} onChange={(event) => setCar(event.target.value as CarBody)}>
            {carBodies.map((body) => (
              <option key={body} value={body}>
                {cars(body)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("price")}>
        <Input
          inputMode="decimal"
          autoComplete="off"
          value={price}
          onChange={(event) => setPrice(toLatinDigits(event.target.value).replace(/,/g, ""))}
          startAdornment={<span className="text-xs font-medium">EGP</span>}
          className="ps-12"
        />
      </Field>
      <Checkbox
        label={t("bothWays")}
        description={from && to ? t("bothWaysHint", { from: name(to), to: name(from) }) : undefined}
        checked={bothWays}
        onChange={(event) => setBothWays(event.target.checked)}
      />
      <p className="text-xs text-muted">{t("specificity")}</p>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <DrawerClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DrawerClose>
        <Button onClick={save} loading={busy} disabled={!ready}>
          {t("submit")}
        </Button>
      </div>
    </div>
  );
}
