"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import type { PricingRow } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { toLatinDigits } from "@/lib/digits";
import { PRICE } from "./PriceDrawer";

type Props = {
  rows: PricingRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
};

// One new price for one row or several selected ones.
export function ChangePriceDialog({ rows, open, onOpenChange, onDone }: Props) {
  const t = useTranslations("staff.pricing.change");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title", { count: rows.length })} description={t("description")}>
        {open && (
          <ChangeForm
            rows={rows}
            onDone={() => {
              onOpenChange(false);
              onDone?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangeForm({ rows, onDone }: { rows: PricingRow[]; onDone: () => void }) {
  const t = useTranslations("staff.pricing.change");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const first = rows[0];
  const [price, setPrice] = useState(
    rows.every((row) => row.price === first?.price) ? (first?.price ?? "") : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = PRICE.test(price) && Number(price) > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const row of rows) {
        await call(staffApi.pricing[":id"].$patch({ param: { id: row.id }, json: { price } }));
      }
      await client.invalidateQueries({ queryKey: ["staff", "pricing"] });
      toast.success(t("saved", { count: rows.length }));
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
      await client.invalidateQueries({ queryKey: ["staff", "pricing"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      <Field label={t("price")}>
        <MoneyInput
          autoFocus
          value={price}
          onChange={(event) => setPrice(toLatinDigits(event.target.value).replace(/,/g, ""))}
        />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button onClick={save} loading={busy} disabled={!valid}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </div>
  );
}
