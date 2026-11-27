"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { IconDownload, IconFileSpreadsheet } from "@tabler/icons-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { call, endpoint, staffApi, useErrorMessage } from "@/lib/api";
import { chunks, planImport, type ImportPlan } from "./csv";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

// Upload an edited price list: rows that match an existing route, class and car change its price, the rest are added.
export function ImportPricesDialog({ open, onOpenChange }: Props) {
  const t = useTranslations("staff.pricing.import");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} className="max-w-lg">
        {open && <ImportForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations("staff.pricing.import");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [file, setFile] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (picked: File | undefined) => {
    setError(null);
    if (!picked) return;
    setFile(picked.name);
    setPlan(planImport(await picked.text()));
  };

  const upload = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const totals = { created: 0, updated: 0, unchanged: 0 };
    try {
      for (const rows of chunks(plan.entries)) {
        const result = await call(staffApi.pricing.$put({ json: { rows } }));
        totals.created += result.created;
        totals.updated += result.updated;
        totals.unchanged += result.unchanged;
      }
      toast.success(t("done", totals));
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: ["staff", "pricing"] });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      <label
        htmlFor="prices-csv"
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-input bg-surface-muted px-4 py-8 text-center has-focus-visible:ring-2 has-focus-visible:ring-ring"
      >
        <IconFileSpreadsheet aria-hidden className="size-8 text-muted" stroke={1.5} />
        <span className="text-sm font-medium text-foreground">{file ?? t("choose")}</span>
        <span className="text-xs text-muted">{t("format")}</span>
        <input
          id="prices-csv"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => void read(event.target.files?.[0])}
        />
      </label>
      <a
        href={`${endpoint}/v1/staff/pricing/export.csv`}
        download
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
      >
        <IconDownload aria-hidden className="size-4" stroke={1.75} />
        {t("template")}
      </a>
      {plan &&
        (plan.missingColumns.length > 0 ? (
          <Alert
            tone="danger"
            title={t("missingColumns", { columns: plan.missingColumns.join(", ") })}
          />
        ) : (
          <Alert
            tone={plan.skipped.length > 0 ? "warning" : "info"}
            title={t("ready", { count: plan.entries.length })}
          >
            {plan.skipped.length > 0 &&
              t("skipped", {
                count: plan.skipped.length,
                lines: plan.skipped.slice(0, 10).join(", ") + (plan.skipped.length > 10 ? "…" : ""),
              })}
          </Alert>
        ))}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button onClick={upload} loading={busy} disabled={!plan || plan.entries.length === 0}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </div>
  );
}
