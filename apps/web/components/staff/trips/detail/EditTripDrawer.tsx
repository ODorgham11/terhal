"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  carBodies,
  fitsCar,
  paymentMethods,
  type CarBody,
  type Trip,
  type UpdateTrip,
} from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Drawer, DrawerClose, DrawerContent } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { toLatinDigits } from "@/lib/digits";
import { Segmented } from "../../Segmented";
import { BrandChoice } from "../../booking/BrandChoice";
import { cairoInstant, cairoParts } from "../../booking/cairo";
import { PlaceField, type Place } from "../../booking/PlaceField";
import { Stepper } from "../../booking/Stepper";
import { PRICE } from "../../pricing/PriceDrawer";
import { tripClassesQuery } from "../../queries";
import { useLocalName } from "../format";
import { useTripChanged } from "./cache";

type Props = { trip: Trip; open: boolean; onOpenChange: (open: boolean) => void };

// Change a trip's details while it's pending or confirmed, and its price, payment and brand until it's completed.
// Only what changed is sent; nothing is repriced on its own.
export function EditTripDrawer({ trip, open, onOpenChange }: Props) {
  const t = useTranslations("staff.trips.edit");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        title={t("title", { code: trip.code })}
        description={t("description")}
        className="max-w-2xl"
        footer={
          <>
            <DrawerClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DrawerClose>
            <Button type="submit" form="edit-trip-form">
              {t("save")}
            </Button>
          </>
        }
      >
        {open && <EditForm trip={trip} onDone={() => onOpenChange(false)} />}
      </DrawerContent>
    </Drawer>
  );
}

const placeOf = (place: Trip["pickup"]): Place => ({
  label: { id: place.id, nameEn: place.nameEn, nameAr: place.nameAr },
  pin: { latitude: place.latitude, longitude: place.longitude },
});

function EditForm({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const t = useTranslations("staff.trips.edit");
  const fields = useTranslations("common.fields");
  const cars = useTranslations("staff.trips.car");
  const payments = useTranslations("staff.trips.detail.price.payment");
  const name = useLocalName();
  const errorMessage = useErrorMessage();
  const changed = useTripChanged();
  const classes = useQuery(tripClassesQuery);
  const details = trip.status === "PENDING" || trip.status === "CONFIRMED";
  const staffBooking = trip.source === "STAFF";
  const start = cairoParts(new Date(trip.pickupDate));

  const [pickup, setPickup] = useState<Place | null>(placeOf(trip.pickup));
  const [dropoff, setDropoff] = useState<Place | null>(placeOf(trip.dropoff));
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [classId, setClassId] = useState(trip.class.id);
  const [car, setCar] = useState<CarBody>(trip.car);
  const [load, setLoad] = useState({
    passengers: trip.passengers,
    largeLuggage: trip.largeLuggage,
    mediumLuggage: trip.mediumLuggage,
    smallLuggage: trip.smallLuggage,
  });
  const [clientName, setClientName] = useState(trip.clientName);
  const [clientPhone, setClientPhone] = useState(trip.clientPhone);
  const [notes, setNotes] = useState(trip.notes ?? "");
  const [price, setPrice] = useState(trip.totalPrice ?? "");
  const [payment, setPayment] = useState(trip.paymentMethod ?? "");
  const [paid, setPaid] = useState(trip.paidAt !== null);
  const [brandId, setBrandId] = useState<string | null>(trip.brand?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const update: UpdateTrip = {};
    if (details) {
      const at = cairoInstant(date, time);
      if (!at || !pickup || !dropoff) return setError(t("incomplete"));
      if (at.toISOString() !== new Date(trip.pickupDate).toISOString())
        update.pickupDate = at.toISOString();
      if (
        pickup.pin.latitude !== trip.pickup.latitude ||
        pickup.pin.longitude !== trip.pickup.longitude
      )
        update.pickup = pickup.pin;
      if (
        dropoff.pin.latitude !== trip.dropoff.latitude ||
        dropoff.pin.longitude !== trip.dropoff.longitude
      )
        update.dropoff = dropoff.pin;
      if (classId !== trip.class.id) update.classId = classId;
      if (car !== trip.car) update.car = car;
      if (load.passengers !== trip.passengers) update.passengers = load.passengers;
      if (load.largeLuggage !== trip.largeLuggage) update.largeLuggage = load.largeLuggage;
      if (load.mediumLuggage !== trip.mediumLuggage) update.mediumLuggage = load.mediumLuggage;
      if (load.smallLuggage !== trip.smallLuggage) update.smallLuggage = load.smallLuggage;
      if (clientName.trim() !== trip.clientName) update.clientName = clientName.trim();
      if (clientPhone.trim() !== trip.clientPhone) update.clientPhone = clientPhone.trim();
      if ((notes.trim() || null) !== trip.notes) update.notes = notes.trim() || null;
    }
    const typed = toLatinDigits(price).replace(/,/g, "").trim();
    if (typed && typed !== trip.totalPrice) {
      if (!PRICE.test(typed)) return setError(t("badPrice"));
      if (Number(typed).toFixed(2) !== trip.totalPrice)
        update.totalPrice = Number(typed).toFixed(2);
    }
    if ((payment || null) !== trip.paymentMethod)
      update.paymentMethod = (payment || null) as UpdateTrip["paymentMethod"];
    if (paid !== (trip.paidAt !== null)) update.paidAt = paid ? new Date().toISOString() : null;
    if (staffBooking && brandId !== (trip.brand?.id ?? null)) update.brandId = brandId;

    if (Object.keys(update).length === 0) return onDone();
    try {
      await call(staffApi.trips[":id"].$patch({ param: { id: trip.id }, json: update }));
      await changed(trip.id);
      toast.success(t("saved"));
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <form
      id="edit-trip-form"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {error && <Alert tone="danger" title={error} />}
      {!details && <Alert tone="info" title={t("locked")} />}

      {details && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("pickup")}>
              <PlaceField value={pickup} onChange={setPickup} />
            </Field>
            <Field label={t("dropoff")}>
              <PlaceField value={dropoff} onChange={setDropoff} />
            </Field>
            <Field label={t("date")}>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label={t("time")} hint={t("cairo")}>
              <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </Field>
            <Field label={fields("class")}>
              <Select value={classId} onChange={(event) => setClassId(event.target.value)}>
                {!classes.data?.data.some((tripClass) => tripClass.id === trip.class.id) && (
                  <option value={trip.class.id}>{name(trip.class)}</option>
                )}
                {classes.data?.data.map((tripClass) => (
                  <option key={tripClass.id} value={tripClass.id}>
                    {name(tripClass)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">{t("car")}</span>
              <Segmented
                label={t("car")}
                value={car}
                onChange={setCar}
                options={carBodies.map((body) => ({ value: body, label: cars(body) }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stepper
              label={t("passengers")}
              min={1}
              value={load.passengers}
              onChange={(passengers) => setLoad({ ...load, passengers })}
            />
            <Stepper
              label={t("large")}
              value={load.largeLuggage}
              onChange={(largeLuggage) => setLoad({ ...load, largeLuggage })}
            />
            <Stepper
              label={t("medium")}
              value={load.mediumLuggage}
              onChange={(mediumLuggage) => setLoad({ ...load, mediumLuggage })}
            />
            <Stepper
              label={t("small")}
              value={load.smallLuggage}
              onChange={(smallLuggage) => setLoad({ ...load, smallLuggage })}
            />
          </div>
          {!fitsCar(car, load) && <p className="text-xs text-danger">{t("tooMuch")}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("passengerName")}>
              <Input
                autoComplete="off"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
              />
            </Field>
            <Field label={t("passengerPhone")}>
              <PhoneInput
                autoComplete="off"
                value={clientPhone}
                onChange={(event) => setClientPhone(event.target.value)}
              />
            </Field>
          </div>
          <Field label={fields("notes")} optional>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <p className="text-xs text-muted">{t("noRepricing")}</p>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("price")} hint={trip.totalPrice ? undefined : t("priceHint")}>
          <MoneyInput value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label={t("payment")}>
          <Select value={payment} onChange={(event) => setPayment(event.target.value)}>
            <option value="">{t("noPayment")}</option>
            {paymentMethods.map((method) => (
              <option key={method} value={method}>
                {payments(method)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Checkbox
        label={t("paid")}
        checked={paid}
        onChange={(event) => setPaid(event.target.checked)}
      />
      {staffBooking && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">{t("brand")}</span>
          <BrandChoice value={brandId} onChange={setBrandId} />
        </div>
      )}
    </form>
  );
}
