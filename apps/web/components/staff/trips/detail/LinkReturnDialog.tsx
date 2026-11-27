"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconSearch } from "@tabler/icons-react";
import type { Trip } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useRoute, useTripDates } from "../format";
import { TripStatusBadge } from "../TripStatusBadge";
import { useTripChanged } from "./cache";

type Props = { trip: Trip; open: boolean; onOpenChange: (open: boolean) => void };

// Makes another trip this one's return: find it by code or passenger, pick it, link.
export function LinkReturnDialog({ trip, open, onOpenChange }: Props) {
  const t = useTranslations("staff.trips.detail.linkReturn");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("title")}
        description={t("description", { code: trip.code })}
        className="max-w-lg"
      >
        {open && <LinkForm trip={trip} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("staff.trips.detail.linkReturn");
  const actions = useTranslations("staff.trips.detail");
  const errorMessage = useErrorMessage();
  const route = useRoute();
  const { dateTime } = useTripDates();
  const changed = useTripChanged();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = q.trim();
  const results = useQuery({
    queryKey: ["staff", "trips", { q: search, from: trip.pickupDate, limit: "8" }],
    queryFn: () =>
      call(staffApi.trips.$get({ query: { q: search, from: trip.pickupDate, limit: "8" } })),
    enabled: search.length >= 2,
  });
  // A return picks up after this trip and isn't already part of a pair.
  const options = (results.data?.data ?? []).filter(
    (candidate) =>
      candidate.id !== trip.id && !candidate.previousTripId && candidate.status !== "CANCELLED",
  );

  const link = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await call(
        staffApi.trips[":id"].link.$post({
          param: { id: trip.id },
          json: { returnTripId: picked },
        }),
      );
      await Promise.all([changed(trip.id), changed(picked)]);
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
      <Field label={t("search")}>
        <Input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t("searchPlaceholder")}
          startAdornment={<IconSearch aria-hidden className="size-4.5" stroke={1.75} />}
        />
      </Field>
      {search.length >= 2 && (
        <ul
          role="listbox"
          aria-label={t("results")}
          className="flex max-h-72 flex-col gap-2 overflow-y-auto"
        >
          {results.isPending ? (
            <li className="py-4 text-center text-sm text-muted">{actions("loading")}</li>
          ) : options.length === 0 ? (
            <li className="py-4 text-center text-sm text-muted">{t("noResults")}</li>
          ) : (
            options.map((candidate) => (
              <li
                key={candidate.id}
                role="option"
                aria-selected={picked === candidate.id}
                tabIndex={0}
                onClick={() => setPicked(candidate.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPicked(candidate.id);
                  }
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  picked === candidate.id
                    ? "border-primary bg-primary-soft"
                    : "border-border hover:bg-surface-muted",
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-foreground">
                    <span dir="ltr">{candidate.code}</span> · {route(candidate)}
                  </span>
                  <span className="text-xs text-muted">
                    {dateTime(candidate.pickupDate)} · {candidate.clientName}
                  </span>
                </span>
                <TripStatusBadge status={candidate.status} />
              </li>
            ))
          )}
        </ul>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{actions("cancel")}</Button>
        </DialogClose>
        <Button onClick={link} loading={busy} disabled={!picked}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </div>
  );
}
