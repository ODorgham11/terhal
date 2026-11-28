"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconArrowsExchange, IconChevronRight } from "@tabler/icons-react";
import {
  carBodies,
  carCapacity,
  fitsCar,
  type CarBody,
  type CustomerDetail,
} from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { SectionCard } from "@/components/staff/SectionCard";
import { Segmented } from "@/components/staff/Segmented";
import { BrandChoice, brandsQuery } from "@/components/staff/booking/BrandChoice";
import { cairoInstant, cairoParts } from "@/components/staff/booking/cairo";
import { CustomerPicker } from "@/components/staff/booking/CustomerPicker";
import { PlaceField, type Place } from "@/components/staff/booking/PlaceField";
import { Stepper } from "@/components/staff/booking/Stepper";
import { PRICE } from "@/components/staff/pricing/PriceDrawer";
import { tripClassesQuery } from "@/components/staff/queries";
import { useLocalName, useTripDates } from "@/components/staff/trips/format";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { toLatinDigits } from "@/lib/digits";

export function NewTrip({ customerId }: { customerId?: string }) {
  return (
    <RequireStaff permission="trips">{() => <Booking customerId={customerId} />}</RequireStaff>
  );
}

type Booker = "customer" | "guest";

const cleanPrice = (value: string) => toLatinDigits(value).replace(/,/g, "").trim();

function Booking({ customerId }: { customerId?: string }) {
  const t = useTranslations("staff.booking");
  const fields = useTranslations("common.fields");
  const cars = useTranslations("staff.trips.car");
  const nav = useTranslations("staff.nav");
  const name = useLocalName();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const classes = useQuery(tripClassesQuery);
  const brands = useQuery(brandsQuery);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [brandId, setBrandId] = useState<string | null | undefined>(undefined);
  const [booker, setBooker] = useState<Booker>("customer");
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const tomorrow = cairoParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const [date, setDate] = useState(tomorrow.date);
  const [time, setTime] = useState("08:00");
  const [classId, setClassId] = useState("");
  const [car, setCar] = useState<CarBody>("SEDAN");
  const [load, setLoad] = useState({
    passengers: 1,
    largeLuggage: 0,
    mediumLuggage: 0,
    smallLuggage: 0,
  });
  const [notes, setNotes] = useState("");
  const [withReturn, setWithReturn] = useState(false);
  const [returnDate, setReturnDate] = useState(tomorrow.date);
  const [returnTime, setReturnTime] = useState("18:00");
  const [price, setPrice] = useState("");
  const [returnPrice, setReturnPrice] = useState("");
  const [backdated, setBackdated] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The default brand is pre-selected once the brands arrive; Terhal (null) when none is the default.
  const chosenBrand =
    brandId !== undefined
      ? brandId
      : (brands.data?.data.find((brand) => brand.isDefault)?.id ?? null);
  // The first class is pre-selected once the classes arrive.
  const chosenClass = classId || classes.data?.data[0]?.id || "";

  // Arriving from a customer's page: book for them.
  const preset = useQuery({
    queryKey: ["staff", "customer", customerId],
    queryFn: () => call(staffApi.customers[":id"].$get({ param: { id: customerId ?? "" } })),
    enabled: !!customerId,
  });
  useEffect(() => {
    if (preset.data) choose(preset.data);
  }, [preset.data]);

  function choose(picked: CustomerDetail | null) {
    setCustomer(picked);
    setClientName(picked ? `${picked.firstName} ${picked.lastName}` : "");
    setClientPhone(picked?.phone ?? "");
  }

  const pins = pickup && dropoff ? { pickup: pickup.pin, dropoff: dropoff.pin } : null;
  const quote = useQuery({
    queryKey: ["staff", "quote", pins, load, withReturn],
    queryFn: () =>
      pins
        ? call(
            staffApi.quotes.$post({
              json: { ...pins, ...load, ...(withReturn && { return: {} }) },
            }),
          )
        : Promise.reject(new Error("No route yet")),
    enabled: pins !== null,
    retry: false,
  });
  const option = quote.data?.options.find(
    (candidate) => candidate.class.id === chosenClass && candidate.car === car,
  );
  const fits = fitsCar(car, load);

  const pickupAt = cairoInstant(date, time);
  const returnAt = withReturn ? cairoInstant(returnDate, returnTime) : null;
  const inPast = pickupAt !== null && pickupAt.getTime() < Date.now();
  const outboundPrice = cleanPrice(price) || option?.price || null;
  const backPrice = withReturn ? cleanPrice(returnPrice) || option?.returnPrice || null : null;
  const total =
    outboundPrice && (!withReturn || backPrice)
      ? Number(outboundPrice) + Number(backPrice ?? 0)
      : null;

  const problems = {
    customer: booker === "customer" && !customer,
    clientName: clientName.trim().length < 2,
    clientPhone: clientPhone.trim().length < 8,
    pickup: !pickup,
    dropoff: !dropoff,
    when: !pickupAt || (inPast && !backdated),
    returnWhen: withReturn && (!returnAt || (pickupAt !== null && returnAt <= pickupAt)),
    price:
      (!!cleanPrice(price) && !PRICE.test(cleanPrice(price))) ||
      (!!cleanPrice(returnPrice) && !PRICE.test(cleanPrice(returnPrice))),
    // Booking on the staff member's own needs a price: there's no booker to accept one later.
    guestPrice: booker === "guest" && (!outboundPrice || (withReturn && !backPrice)),
    load: !fits,
  };
  const blocked = Object.values(problems).some(Boolean);

  const book = async () => {
    setTried(true);
    if (blocked || !pickup || !dropoff || !pickupAt) return;
    setBusy(true);
    setError(null);
    try {
      const booked = await call(
        staffApi.trips.$post({
          header: { "idempotency-key": idempotencyKey },
          json: {
            classId: chosenClass,
            car,
            pickup: pickup.pin,
            dropoff: dropoff.pin,
            pickupDate: pickupAt.toISOString(),
            ...load,
            clientName: clientName.trim(),
            clientPhone: clientPhone.trim(),
            ...(notes.trim() && { notes: notes.trim() }),
            ...(booker === "customer" && customer && { customerId: customer.id }),
            ...(cleanPrice(price) && { totalPrice: Number(cleanPrice(price)).toFixed(2) }),
            brandId: chosenBrand,
            backdated: inPast,
            ...(withReturn &&
              returnAt && {
                return: {
                  pickupDate: returnAt.toISOString(),
                  ...(cleanPrice(returnPrice) && {
                    totalPrice: Number(cleanPrice(returnPrice)).toFixed(2),
                  }),
                },
              }),
          },
        }),
      );
      toast.success(t("booked", { code: booked.trip.code }));
      router.push(`/trips/${booked.trip.id}`);
    } catch (failure) {
      setError(errorMessage(failure));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  };

  const show = (problem: boolean) => tried && problem;

  return (
    <>
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/trips" className="text-primary hover:underline">
          {nav("trips")}
        </Link>
        <DirectionalIcon icon={IconChevronRight} className="size-3.5 text-muted" />
        <span className="text-muted">{t("title")}</span>
      </nav>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="text-base text-muted">{t("description")}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link href="/trips">{t("cancel")}</Link>
          </Button>
          <Button onClick={() => void book()} loading={busy}>
            {t("submit")}
          </Button>
        </div>
      </header>
      {error && <Alert tone="danger" title={error} />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard title={t("brand.title")}>
            <BrandChoice value={chosenBrand} onChange={setBrandId} />
            <p className="text-xs text-muted">{t("brand.hint")}</p>
          </SectionCard>

          <SectionCard
            title={t("booker.title")}
            aside={
              <Segmented
                label={t("booker.title")}
                value={booker}
                onChange={(value) => {
                  setBooker(value);
                  if (value === "guest") choose(null);
                }}
                options={[
                  { value: "customer", label: t("booker.customer") },
                  { value: "guest", label: t("booker.guest") },
                ]}
              />
            }
          >
            {booker === "customer" ? (
              <Field
                label={t("booker.customer")}
                hint={
                  customer
                    ? t("booker.tripsSoFar", { count: customer.tripCount })
                    : t("booker.searchHint")
                }
                error={show(problems.customer) ? t("errors.customer") : undefined}
              >
                <CustomerPicker
                  value={customer}
                  onChange={choose}
                  invalid={show(problems.customer)}
                />
              </Field>
            ) : (
              <p className="text-sm text-muted">{t("booker.guestHint")}</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("booker.passengerName")}
                error={show(problems.clientName) ? t("errors.clientName") : undefined}
              >
                <Input
                  autoComplete="off"
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                />
              </Field>
              <Field
                label={t("booker.passengerPhone")}
                error={show(problems.clientPhone) ? t("errors.clientPhone") : undefined}
              >
                <PhoneInput
                  countries="all"
                  autoComplete="off"
                  value={clientPhone}
                  onChange={setClientPhone}
                />
              </Field>
            </div>
            {booker === "customer" && (
              <p className="text-xs text-muted">{t("booker.passengerHint")}</p>
            )}
          </SectionCard>

          <SectionCard title={t("route.title")}>
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Field
                label={t("route.pickup")}
                error={show(problems.pickup) ? t("errors.place") : undefined}
              >
                <PlaceField value={pickup} onChange={setPickup} invalid={show(problems.pickup)} />
              </Field>
              <Button
                variant="secondary"
                size="icon"
                className="sm:mt-7"
                aria-label={t("route.swap")}
                onClick={() => {
                  setPickup(dropoff);
                  setDropoff(pickup);
                }}
              >
                <IconArrowsExchange aria-hidden className="size-4.5" stroke={1.75} />
              </Button>
              <Field
                label={t("route.dropoff")}
                error={show(problems.dropoff) ? t("errors.place") : undefined}
              >
                <PlaceField
                  value={dropoff}
                  onChange={setDropoff}
                  invalid={show(problems.dropoff)}
                />
              </Field>
            </div>
            <p className="text-xs text-muted">{t("route.hint")}</p>
          </SectionCard>

          <SectionCard title={t("when.title")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("when.date")}
                error={
                  show(problems.when) ? (inPast ? t("errors.past") : t("errors.when")) : undefined
                }
              >
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field label={t("when.time")} hint={t("when.cairo")}>
                <Input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </Field>
            </div>
            {inPast && (
              <Checkbox
                label={t("when.backdated")}
                description={t("when.backdatedHint")}
                checked={backdated}
                onChange={(event) => setBackdated(event.target.checked)}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={fields("class")}>
                <Select value={chosenClass} onChange={(event) => setClassId(event.target.value)}>
                  {classes.data?.data.map((tripClass) => (
                    <option key={tripClass.id} value={tripClass.id}>
                      {name(tripClass)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">{t("when.car")}</span>
                <Segmented
                  label={t("when.car")}
                  value={car}
                  onChange={setCar}
                  options={carBodies.map((body) => ({ value: body, label: cars(body) }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stepper
                label={t("load.passengers")}
                min={1}
                value={load.passengers}
                onChange={(passengers) => setLoad({ ...load, passengers })}
              />
              <Stepper
                label={t("load.large")}
                value={load.largeLuggage}
                onChange={(largeLuggage) => setLoad({ ...load, largeLuggage })}
              />
              <Stepper
                label={t("load.medium")}
                value={load.mediumLuggage}
                onChange={(mediumLuggage) => setLoad({ ...load, mediumLuggage })}
              />
              <Stepper
                label={t("load.small")}
                value={load.smallLuggage}
                onChange={(smallLuggage) => setLoad({ ...load, smallLuggage })}
              />
            </div>
            <p className={fits ? "text-xs text-success" : "text-xs text-danger"}>
              {t(fits ? "load.fits" : "load.tooMuch", {
                car: cars(car),
                passengers: carCapacity[car].passengers,
                large: carCapacity[car].largeLuggage,
              })}
            </p>
          </SectionCard>

          <SectionCard title={t("extras.title")}>
            <Field label={t("extras.notes")} optional>
              <Textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("extras.notesPlaceholder")}
              />
            </Field>
            <Switch
              label={t("extras.return")}
              description={t("extras.returnHint")}
              checked={withReturn}
              onChange={(event) => setWithReturn(event.target.checked)}
            />
            {withReturn && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t("extras.returnDate")}
                  error={show(problems.returnWhen) ? t("errors.returnWhen") : undefined}
                >
                  <Input
                    type="date"
                    value={returnDate}
                    onChange={(event) => setReturnDate(event.target.value)}
                  />
                </Field>
                <Field label={t("extras.returnTime")}>
                  <Input
                    type="time"
                    value={returnTime}
                    onChange={(event) => setReturnTime(event.target.value)}
                  />
                </Field>
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="flex flex-col gap-5 xl:sticky xl:top-20">
          <QuoteCard
            pickup={pickup}
            dropoff={dropoff}
            when={pickupAt}
            returnWhen={returnAt}
            className={chosenClass}
            car={car}
            loading={quote.isFetching}
            quoteError={quote.isError ? errorMessage(quote.error) : null}
            listPrice={option?.price ?? null}
            listReturnPrice={option?.returnPrice ?? null}
            withReturn={withReturn}
            total={total}
          >
            <Field
              label={t("quote.price")}
              optional
              hint={t("quote.priceHint")}
              error={
                show(problems.price)
                  ? t("errors.price")
                  : show(problems.guestPrice)
                    ? t("errors.guestPrice")
                    : undefined
              }
            >
              <MoneyInput
                value={price}
                placeholder={option?.price ?? ""}
                onChange={(event) => setPrice(event.target.value)}
              />
            </Field>
            {withReturn && (
              <Field label={t("quote.returnPrice")} optional>
                <MoneyInput
                  value={returnPrice}
                  placeholder={option?.returnPrice ?? ""}
                  onChange={(event) => setReturnPrice(event.target.value)}
                />
              </Field>
            )}
            <Button size="lg" onClick={() => void book()} loading={busy}>
              {t("submit")}
            </Button>
            {tried && blocked && <p className="text-xs text-danger">{t("errors.fixAbove")}</p>}
          </QuoteCard>
          <SectionCard title={t("onRequest.title")}>
            <p className="text-xs text-muted">{t("onRequest.body")}</p>
          </SectionCard>
        </aside>
      </div>
    </>
  );
}

function QuoteCard({
  pickup,
  dropoff,
  when,
  returnWhen,
  className: classId,
  car,
  loading,
  quoteError,
  listPrice,
  listReturnPrice,
  withReturn,
  total,
  children,
}: {
  pickup: Place | null;
  dropoff: Place | null;
  when: Date | null;
  returnWhen: Date | null;
  className: string;
  car: CarBody;
  loading: boolean;
  quoteError: string | null;
  listPrice: string | null;
  listReturnPrice: string | null;
  withReturn: boolean;
  total: number | null;
  children: ReactNode;
}) {
  const t = useTranslations("staff.booking.quote");
  const cars = useTranslations("staff.trips.car");
  const name = useLocalName();
  const classes = useQuery(tripClassesQuery);
  const { dateTime, price } = useTripDates();
  const tripClass = classes.data?.data.find((candidate) => candidate.id === classId);
  const ready = pickup && dropoff;

  const leg = (label: string, from: Place, to: Place, at: Date | null, amount: string | null) => (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between gap-3 text-xs text-muted">
        <span>{label}</span>
        <span className="text-sm font-medium text-foreground tabular-nums">
          {amount ? (
            price(amount)
          ) : (
            <span className="text-xs font-normal text-warning">{t("onRequest")}</span>
          )}
        </span>
      </div>
      <span className="text-sm text-foreground">
        {name(from.label)} → {name(to.label)}
      </span>
      <span className="text-xs text-muted">
        {[at && dateTime(at.toISOString()), tripClass && name(tripClass), cars(car)]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );

  return (
    <SectionCard title={t("title")}>
      {!ready ? (
        <p className="text-sm text-muted">{t("pickRoute")}</p>
      ) : quoteError ? (
        <Alert tone="danger" title={quoteError} />
      ) : (
        <div className="flex flex-col gap-3">
          {leg(t("outbound"), pickup, dropoff, when, listPrice)}
          {withReturn && leg(t("return"), dropoff, pickup, returnWhen, listReturnPrice)}
          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-base font-semibold text-foreground">{t("total")}</span>
            <span className="text-xl font-semibold text-foreground tabular-nums">
              {loading ? "…" : total !== null ? price(total.toFixed(2)) : t("onRequest")}
            </span>
          </div>
        </div>
      )}
      {children}
    </SectionCard>
  );
}
