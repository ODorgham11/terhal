"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import type { Driver } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { FadeText, fade } from "@/components/ui/Motion";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { Segmented } from "../Segmented";
import { useBalance } from "./format";

type Kind = "payment" | "adjustment";
// Up: the company owes the driver more. Down: less.
type Direction = "up" | "down";

const AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

type Props = { driver: Driver; open: boolean; onOpenChange: (open: boolean) => void };

// Money moving between the company and a driver, or a correction to their balance. Ledger entries can't be edited,
// so a mistake is fixed with another adjustment.
export function RecordPaymentDialog({ driver, open, onOpenChange }: Props) {
  const t = useTranslations("staff.fleet.payment");
  const balance = useBalance();
  const name = `${driver.firstName} ${driver.lastName}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("title")}
        description={`${name} · ${balance(driver.amountOwed).text}`}
      >
        {open && <PaymentForm driver={driver} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({ driver, onDone }: { driver: Driver; onDone: () => void }) {
  const t = useTranslations("staff.fleet.payment");
  const fields = useTranslations("common.fields");
  const errorMessage = useErrorMessage();
  const balance = useBalance();
  const client = useQueryClient();
  const owes = Number(driver.amountOwed) < 0;

  const [kind, setKind] = useState<Kind>("payment");
  // A driver holding company cash usually hands it in; one who's owed usually gets paid.
  const [direction, setDirection] = useState<Direction>(owes ? "up" : "down");
  const [amount, setAmount] = useState(
    Math.abs(Number(driver.amountOwed)) ? Math.abs(Number(driver.amountOwed)).toFixed(2) : "",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = AMOUNT.test(amount) && Number(amount) > 0;
  const after = valid
    ? (Number(driver.amountOwed) + (direction === "up" ? 1 : -1) * Number(amount)).toFixed(2)
    : null;
  const needsNote = kind === "adjustment" && note.trim() === "";

  const submit = async () => {
    setBusy(true);
    setError(null);
    const trimmed = note.trim() || undefined;
    const json =
      kind === "adjustment"
        ? {
            type: "ADJUSTMENT" as const,
            amount: direction === "up" ? amount : `-${amount}`,
            note: note.trim(),
          }
        : direction === "up"
          ? { type: "CASH_HANDED_IN" as const, amount, note: trimmed }
          : { type: "PAYOUT" as const, amount, note: trimmed };
    try {
      await call(staffApi.drivers[":id"].transactions.$post({ param: { id: driver.id }, json }));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["staff", "driver", driver.id] }),
        client.invalidateQueries({ queryKey: ["staff", "drivers"] }),
      ]);
      toast.success(t("recorded"));
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={fade.transition}
            className="-mb-4 overflow-hidden"
          >
            <div className="pb-4">
              <Alert tone="danger" title={error} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Field label={t("kind")}>
        <Segmented
          label={t("kind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "payment", label: t("kinds.payment") },
            { value: "adjustment", label: t("kinds.adjustment") },
          ]}
        />
      </Field>
      <Field label={t("direction")}>
        <Segmented
          label={t("direction")}
          value={direction}
          onChange={setDirection}
          options={
            kind === "payment"
              ? [
                  { value: "up", label: t("directions.driverPaidUs") },
                  { value: "down", label: t("directions.wePaidDriver") },
                ]
              : [
                  { value: "up", label: t("directions.raise") },
                  { value: "down", label: t("directions.lower") },
                ]
          }
        />
      </Field>
      <Field
        label={fields("amount")}
        hint={
          after !== null ? (
            <FadeText value={t("after", { balance: balance(after).text })} />
          ) : undefined
        }
      >
        <MoneyInput
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/,/g, ""))}
        />
      </Field>
      <Field
        label={fields("note")}
        optional={kind === "payment"}
        hint={kind === "adjustment" ? <FadeText value={t("noteRequired")} /> : undefined}
      >
        <Textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t("notePlaceholder")}
        />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button onClick={submit} loading={busy} disabled={!valid || needsNote}>
          {t("record")}
        </Button>
      </DialogFooter>
    </div>
  );
}
