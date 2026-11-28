"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconBrandWhatsapp, IconCopy, IconRefresh } from "@tabler/icons-react";
import type { Trip } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { useTripDates } from "../format";
import { useTripChanged } from "./cache";

type Props = { trip: Trip; open: boolean; onOpenChange: (open: boolean) => void };

// The link the driver fills their report in, to copy or send on WhatsApp. A new link stops the old one working.
export function ReportLinkDialog({ trip, open, onOpenChange }: Props) {
  const t = useTranslations("staff.trips.detail.reportLink");
  // The WhatsApp message is in the dashboard's language; drivers read Arabic, so that's the usual one.
  const locale = useLocale() === "en" ? "en" : "ar";
  const errorMessage = useErrorMessage();
  const { dateTime } = useTripDates();
  const client = useQueryClient();
  const changed = useTripChanged();
  const [regenerating, setRegenerating] = useState(false);
  const key = ["staff", "trip", trip.id, "report-link", locale];

  const link = useQuery({
    queryKey: key,
    queryFn: () =>
      call(
        staffApi.trips[":id"]["report-link"].$get({ param: { id: trip.id }, query: { locale } }),
      ),
    enabled: open,
    retry: false,
  });

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const fresh = await call(
        staffApi.trips[":id"]["report-link"].$post({ param: { id: trip.id }, query: { locale } }),
      );
      client.setQueryData(key, fresh);
      await changed(trip.id);
      toast.success(t("regenerated"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("title")}
        description={
          trip.driver
            ? t("description", { driver: `${trip.driver.firstName} ${trip.driver.lastName}` })
            : undefined
        }
      >
        {link.isPending ? (
          <div className="flex justify-center py-6 text-muted">
            <Spinner className="size-5" />
          </div>
        ) : link.isError ? (
          <Alert tone="danger" title={errorMessage(link.error)} />
        ) : (
          <div className="flex flex-col gap-4">
            <Field label={t("link")} hint={t("expires", { date: dateTime(link.data.expiresAt) })}>
              <Input
                readOnly
                value={link.data.url}
                dir="ltr"
                onFocus={(event) => event.target.select()}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(link.data.url)
                    .then(() => toast.success(t("copied")));
                }}
              >
                <IconCopy aria-hidden className="size-5" stroke={1.75} />
                {t("copy")}
              </Button>
              <Button asChild>
                <a href={link.data.whatsappUrl} target="_blank" rel="noreferrer">
                  <IconBrandWhatsapp aria-hidden className="size-5" stroke={1.75} />
                  {t("whatsapp")}
                </a>
              </Button>
            </div>
          </div>
        )}
        <DialogFooter className="justify-between">
          <Button
            variant="ghost"
            onClick={regenerate}
            loading={regenerating}
            disabled={!trip.driver}
          >
            {!regenerating && <IconRefresh aria-hidden className="size-4" stroke={1.75} />}
            {t("regenerate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
