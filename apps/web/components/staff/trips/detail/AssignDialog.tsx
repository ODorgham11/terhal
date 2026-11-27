"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { Trip, TripConflict } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Radio, RadioGroup } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";
import { useTripDates } from "../format";
import { useTripChanged } from "./cache";

type Props = { trip: Trip; open: boolean; onOpenChange: (open: boolean) => void };

type Mode = "internal" | "office";

// Our own driver and vehicle, or a partner office (its driver and vehicle when known). Opened fresh each time, so it
// starts from the trip's current assignment.
export function AssignDialog({ trip, open, onOpenChange }: Props) {
  const t = useTranslations("staff.trips.detail.assign");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("title", { code: trip.code })}
        description={t("description")}
        className="max-w-lg"
      >
        {open && <AssignForm trip={trip} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AssignForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("staff.trips.detail.assign");
  const actions = useTranslations("staff.trips.detail");
  const errorMessage = useErrorMessage();
  const changed = useTripChanged();

  const [mode, setMode] = useState<Mode>(trip.office ? "office" : "internal");
  const [officeId, setOfficeId] = useState(trip.office?.id ?? "");
  const [driverId, setDriverId] = useState(trip.driver?.id ?? "");
  const [vehicleId, setVehicleId] = useState(trip.vehicle?.id ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: ["staff", "trip", trip.id, "candidates"],
    queryFn: () =>
      call(staffApi.trips[":id"].assignment.candidates.$get({ param: { id: trip.id } })),
  });
  const offices = useQuery({
    queryKey: ["staff", "offices", "all"],
    queryFn: () => call(staffApi.offices.$get({ query: { limit: "100" } })),
    staleTime: 5 * 60_000,
  });

  // Our own people, or the chosen office's.
  const belongs = (item: { officeId: string | null }) =>
    mode === "office" ? item.officeId === officeId : item.officeId === null;
  const drivers = candidates.data?.drivers.filter(belongs) ?? [];
  const vehicles = candidates.data?.vehicles.filter(belongs) ?? [];
  const driver = drivers.find((candidate) => candidate.id === driverId);
  const vehicle = vehicles.find((candidate) => candidate.id === vehicleId);
  const conflicts = [...(driver?.conflicts ?? []), ...(vehicle?.conflicts ?? [])];

  const switchMode = (next: Mode) => {
    setMode(next);
    setDriverId("");
    setVehicleId("");
    setAcknowledged(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(
        staffApi.trips[":id"].assignment.$put({
          param: { id: trip.id },
          json: {
            driverId: driverId || null,
            vehicleId: vehicleId || null,
            officeId: mode === "office" ? officeId || null : null,
            acknowledgeConflicts: acknowledged,
          },
        }),
      );
      await changed(trip.id);
      onDone();
    } catch (failure) {
      setError(
        isApiError(failure) && failure.code === "ASSIGNMENT_CONFLICT"
          ? t("conflictRefused")
          : errorMessage(failure),
      );
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === "office" ? Boolean(officeId) : Boolean(driverId && vehicleId);

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      {candidates.isError && <Alert tone="danger" title={errorMessage(candidates.error)} />}

      <RadioGroup legend={t("who")}>
        <Radio
          name="mode"
          value="internal"
          label={t("internal")}
          checked={mode === "internal"}
          onChange={() => switchMode("internal")}
        />
        <Radio
          name="mode"
          value="office"
          label={t("office")}
          description={t("officeHint")}
          checked={mode === "office"}
          onChange={() => switchMode("office")}
        />
      </RadioGroup>

      {mode === "office" && (
        <Field label={t("officeLabel")}>
          <Select
            value={officeId}
            onChange={(event) => {
              setOfficeId(event.target.value);
              setDriverId("");
              setVehicleId("");
            }}
            placeholder={t("chooseOffice")}
          >
            {offices.data?.data.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label={t("driver")} optional={mode === "office"}>
        <Select
          value={driverId}
          onChange={(event) => {
            setDriverId(event.target.value);
            setAcknowledged(false);
          }}
          placeholder={candidates.isPending ? actions("loading") : t("chooseDriver")}
          disabled={candidates.isPending || (mode === "office" && !officeId)}
        >
          {drivers.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.firstName} {candidate.lastName}
              {candidate.conflicts.length > 0 ? ` · ${t("busy")}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("vehicle")} optional={mode === "office"} hint={t("vehicleHint")}>
        <Select
          value={vehicleId}
          onChange={(event) => {
            setVehicleId(event.target.value);
            setAcknowledged(false);
          }}
          placeholder={candidates.isPending ? actions("loading") : t("chooseVehicle")}
          disabled={candidates.isPending || (mode === "office" && !officeId)}
        >
          {vehicles.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.make} {candidate.model} · {candidate.plateNumber}
              {candidate.conflicts.length > 0 ? ` · ${t("busy")}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      {conflicts.length > 0 && (
        <Alert tone="warning" title={t("conflictTitle")}>
          <ConflictList conflicts={conflicts} />
          <Checkbox
            className="mt-2"
            label={t("acknowledge")}
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
        </Alert>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{actions("cancel")}</Button>
        </DialogClose>
        <Button
          onClick={save}
          loading={busy}
          disabled={!ready || (conflicts.length > 0 && !acknowledged)}
        >
          {t("submit")}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ConflictList({ conflicts }: { conflicts: TripConflict[] }) {
  const { dateTime } = useTripDates();
  const unique = [...new Map(conflicts.map((conflict) => [conflict.id, conflict])).values()];
  return (
    <ul className="flex flex-col gap-0.5">
      {unique.map((conflict) => (
        <li key={conflict.id}>
          <span dir="ltr">{conflict.code}</span> · {dateTime(conflict.pickupDate)}
        </li>
      ))}
    </ul>
  );
}
