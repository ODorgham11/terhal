"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  STAFF_ONLY_EXPENSES,
  SubmitReport,
  expenseTypes,
  type DriverTrip,
  type ExpenseType,
} from "@terhal/contracts";
import { ConfirmDialog } from "@/components/staff/ConfirmDialog";
import { cairoInstant, cairoParts } from "@/components/staff/booking/cairo";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DatePicker, TimePicker } from "@/components/ui/DatePicker";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { fade } from "@/components/ui/Motion";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { WholeNumberInput } from "@/components/ui/WholeNumberInput";
import { toast } from "@/components/ui/Toast";
import { call, isApiError, siteApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { reportKey } from "./keys";

// The driver's report: every field the API requires (SubmitReport), checked against the same schema before it's sent.
// The draft lives in this phone's storage until it's sent (D3 a: the API only takes the finished report).

type When = { date: string; time: string };
type Stop = { key: string; address: string; startedAt: When; endedAt: When; notes: string };
type Expense = { key: string; type: ExpenseType | ""; amount: string; notes: string };
type Draft = {
  startedAt: When;
  vehiclePickup: string;
  startMileage: string;
  pickupAt: When;
  dropoffAt: When;
  endedAt: When;
  vehicleDropoff: string;
  endMileage: string;
  cashCollected: string;
  stops: Stop[];
  expenses: Expense[];
};

const driverExpenses = expenseTypes.filter((type) => !STAFF_ONLY_EXPENSES.includes(type));

const whenOf = (iso: string | null, fallbackDate: string): When =>
  iso ? cairoParts(new Date(iso)) : { date: fallbackDate, time: "" };

const instant = (when: When) => cairoInstant(when.date, when.time)?.toISOString() ?? "";

const freshDraft = (trip: DriverTrip): Draft => {
  const day = cairoParts(new Date(trip.pickupDate)).date;
  return {
    startedAt: whenOf(trip.startedAt, day),
    vehiclePickup: "",
    startMileage: "",
    pickupAt: { date: day, time: "" },
    dropoffAt: { date: day, time: "" },
    endedAt: whenOf(trip.endedAt, day),
    vehicleDropoff: "",
    endMileage: "",
    cashCollected: "",
    stops: [],
    expenses: [],
  };
};

const storageKey = (token: string) => `terhal.report.${token.slice(0, 16)}`;

const loadDraft = (token: string): Draft | null => {
  try {
    const saved = window.localStorage.getItem(storageKey(token));
    return saved ? (JSON.parse(saved) as Draft) : null;
  } catch {
    return null;
  }
};

// What the API takes, built from the draft. Empty answers stay empty, so the schema names them.
const payloadOf = (draft: Draft) => ({
  startedAt: instant(draft.startedAt),
  vehiclePickup: draft.vehiclePickup,
  startMileage: draft.startMileage === "" ? Number.NaN : Number(draft.startMileage),
  pickupAt: instant(draft.pickupAt),
  dropoffAt: instant(draft.dropoffAt),
  vehicleDropoff: draft.vehicleDropoff,
  endedAt: instant(draft.endedAt),
  endMileage: draft.endMileage === "" ? Number.NaN : Number(draft.endMileage),
  // Nothing entered means nothing collected.
  cashCollected: draft.cashCollected.trim() || "0",
  stops: draft.stops.map((stop) => ({
    address: stop.address,
    startedAt: instant(stop.startedAt),
    endedAt: instant(stop.endedAt),
    ...(stop.notes.trim() && { notes: stop.notes }),
  })),
  expenses: draft.expenses.map((expense) => ({
    type: expense.type,
    amount: expense.amount,
    ...(expense.notes.trim() && { notes: expense.notes }),
  })),
});

type ErrorKey = "required" | "number" | "amount" | "order" | "mileage" | "stopTimes" | "invalid";
type Errors = Record<string, ErrorKey>;

const MILEAGE = new Set(["startMileage", "endMileage"]);

// Each problem the schema finds, as a key for the field's message: the API's messages are English and for logs.
const errorsOf = (draft: Draft): Errors => {
  const result = SubmitReport.safeParse(payloadOf(draft));
  if (result.success) return {};
  const errors: Errors = {};
  const payload = payloadOf(draft) as Record<string, unknown>;
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    if (errors[path]) continue;
    const value = issue.path.reduce<unknown>(
      (at, part) => (at as Record<string | number, unknown> | undefined)?.[part as string],
      payload,
    );
    const empty = value === "" || (typeof value === "number" && Number.isNaN(value));
    const field = String(issue.path.at(-1));
    errors[path] = empty
      ? "required"
      : issue.code === "custom"
        ? issue.path[0] === "stops"
          ? "stopTimes"
          : field === "endMileage"
            ? "mileage"
            : "order"
        : MILEAGE.has(field)
          ? "number"
          : field === "cashCollected" || field === "amount"
            ? "amount"
            : "invalid";
  }
  return errors;
};

export function ReportForm({ trip, token }: { trip: DriverTrip; token: string }) {
  const t = useTranslations("report.form");
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(token) ?? freshDraft(trip));
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const errors = tried ? { ...errorsOf(draft), ...serverErrors } : {};
  const message = (path: string) => (errors[path] ? t(`errors.${errors[path]}`) : undefined);

  // Kept on the phone as it's typed, so a dropped signal or a closed tab loses nothing.
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(token), JSON.stringify(draft));
    } catch {
      // Private browsing: the draft just isn't kept.
    }
  }, [draft, token]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerErrors({});
  };

  const review = () => {
    setTried(true);
    if (Object.keys(errorsOf(draft)).length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setConfirming(true);
  };

  const submit = async () => {
    try {
      const parsed = SubmitReport.parse(payloadOf(draft));
      const sent = await call(
        siteApi.driver.report.$put({ header: { "report-token": token }, json: parsed }),
      );
      window.localStorage.removeItem(storageKey(token));
      client.setQueryData(reportKey(token), sent);
      toast.success(t("submit"));
    } catch (error) {
      if (isApiError(error) && error.code === "VALIDATION_FAILED") {
        setServerErrors(Object.fromEntries(error.errors.map((issue) => [issue.path, "invalid"])));
        setConfirming(false);
        return;
      }
      throw error;
    }
  };

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border bg-white p-5 shadow-xs">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg leading-6 font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted">{t("description")}</p>
      </div>
      <AnimatePresence initial={false}>
        {hasErrors && (
          <motion.div key="fix" {...fade}>
            <Alert tone="danger" title={t("fix")} />
          </motion.div>
        )}
      </AnimatePresence>

      <Group title={t("vehicleOut")}>
        <WhenField
          label={t("startedAt")}
          value={draft.startedAt}
          onChange={(value) => set("startedAt", value)}
          error={message("startedAt")}
        />
        <Field label={t("vehiclePickup")} error={message("vehiclePickup")}>
          <Input
            value={draft.vehiclePickup}
            onChange={(event) => set("vehiclePickup", event.target.value)}
          />
        </Field>
        <Field label={t("startMileage")} error={message("startMileage")}>
          <WholeNumberInput
            value={draft.startMileage}
            onChange={(event) => set("startMileage", event.target.value)}
            endAdornment={<span className="pe-2 text-xs font-medium">{t("km")}</span>}
          />
        </Field>
      </Group>

      <Group title={t("theTrip")}>
        <WhenField
          label={t("pickupAt")}
          value={draft.pickupAt}
          onChange={(value) => set("pickupAt", value)}
          error={message("pickupAt")}
        />
        <WhenField
          label={t("dropoffAt")}
          value={draft.dropoffAt}
          onChange={(value) => set("dropoffAt", value)}
          error={message("dropoffAt")}
        />
        <Repeated
          title={t("stops")}
          addLabel={t("addStop")}
          items={draft.stops}
          onAdd={() =>
            set("stops", [
              ...draft.stops,
              {
                key: crypto.randomUUID(),
                address: "",
                startedAt: { date: draft.pickupAt.date, time: "" },
                endedAt: { date: draft.pickupAt.date, time: "" },
                notes: "",
              },
            ])
          }
          onRemove={(key) =>
            set(
              "stops",
              draft.stops.filter((stop) => stop.key !== key),
            )
          }
          label={(index) => t("stop", { number: index + 1 })}
          render={(stop, index) => {
            const update = (change: Partial<Stop>) =>
              set(
                "stops",
                draft.stops.map((item) => (item.key === stop.key ? { ...item, ...change } : item)),
              );
            return (
              <>
                <Field label={t("stopAddress")} error={message(`stops.${index}.address`)}>
                  <Input
                    value={stop.address}
                    onChange={(event) => update({ address: event.target.value })}
                  />
                </Field>
                <WhenField
                  label={t("stopFrom")}
                  value={stop.startedAt}
                  onChange={(startedAt) => update({ startedAt })}
                  error={message(`stops.${index}.startedAt`)}
                />
                <WhenField
                  label={t("stopTo")}
                  value={stop.endedAt}
                  onChange={(endedAt) => update({ endedAt })}
                  error={message(`stops.${index}.endedAt`)}
                />
                <NoteField value={stop.notes} onChange={(notes) => update({ notes })} />
              </>
            );
          }}
        />
      </Group>

      <Group title={t("vehicleBack")}>
        <WhenField
          label={t("endedAt")}
          value={draft.endedAt}
          onChange={(value) => set("endedAt", value)}
          error={message("endedAt")}
        />
        <Field label={t("vehicleDropoff")} error={message("vehicleDropoff")}>
          <Input
            value={draft.vehicleDropoff}
            onChange={(event) => set("vehicleDropoff", event.target.value)}
          />
        </Field>
        <Field label={t("endMileage")} error={message("endMileage")}>
          <WholeNumberInput
            value={draft.endMileage}
            onChange={(event) => set("endMileage", event.target.value)}
            endAdornment={<span className="pe-2 text-xs font-medium">{t("km")}</span>}
          />
        </Field>
      </Group>

      <Group title={t("money")}>
        <Field label={t("cashCollected")} optional error={message("cashCollected")}>
          <MoneyInput
            placeholder="0"
            value={draft.cashCollected}
            onChange={(event) => set("cashCollected", event.target.value)}
          />
        </Field>
        <ExpensesField
          expenses={draft.expenses}
          onChange={(expenses) => set("expenses", expenses)}
          message={message}
        />
      </Group>

      <Button size="lg" onClick={review}>
        {t("submit")}
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirmTitle")}
        description={t("confirmBody")}
        confirmLabel={t("submit")}
        onConfirm={submit}
      />
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-border pt-5">
      <legend className="float-start mb-4 w-full text-[0.9375rem] font-semibold text-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

// An instant on Cairo time: the day from the calendar, the time from the phone's own picker.
function WhenField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: When;
  onChange: (value: When) => void;
  error?: string;
}) {
  const t = useTranslations("report.form");
  const timeId = useId();
  return (
    <Field label={label} error={error}>
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
        <DatePicker
          value={value.date}
          onChange={(date) => onChange({ ...value, date })}
          aria-label={`${label}, ${t("date")}`}
        />
        <TimePicker
          id={timeId}
          value={value.time}
          onChange={(time) => onChange({ ...value, time })}
          aria-label={`${label}, ${t("time")}`}
          aria-invalid={error ? true : undefined}
        />
      </div>
    </Field>
  );
}

// Opening and closing in two layers: the outer one only changes height (and clips), the inner one fades and settles
// into place. Moving the clipping box itself is what made it judder. In: the space opens, the content fades in as it
// does. Out: the content fades first, then the space closes after it.
const curve = [0.32, 0.72, 0, 1] as const;
const grow = {
  initial: { height: 0 },
  animate: { height: "auto", transition: { duration: 0.36, ease: curve } },
  exit: { height: 0, transition: { duration: 0.32, delay: 0.06, ease: curve } },
} as const;
const settle = {
  initial: { opacity: 0, y: -8, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.36, delay: 0.04, ease: curve },
  },
  exit: { opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.16, ease: "easeIn" } },
} as const;

// A list the driver adds to and removes from, each item easing in and out.
function Repeated<Item extends { key: string }>({
  title,
  addLabel,
  items,
  onAdd,
  onRemove,
  label,
  render,
}: {
  title: string;
  addLabel: string;
  items: Item[];
  onAdd: () => void;
  onRemove: (key: string) => void;
  label: (index: number) => string;
  render: (item: Item, index: number) => ReactNode;
}) {
  const t = useTranslations("report.form");
  // No flex gap between the items: each carries its own space below (pb-3) inside the height that animates, so the
  // space grows and shrinks with it instead of jumping in first.
  return (
    <div className="flex flex-col">
      <span className="pb-3 text-sm font-medium text-foreground">{title}</span>
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.div key={item.key} {...grow} className="overflow-hidden">
            <motion.div
              {...settle}
              className="mb-3 flex origin-top flex-col gap-4 rounded-xl border border-border bg-surface-muted/40 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{label(index)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(item.key)}
                  className="-me-2 text-muted hover:text-danger"
                >
                  <IconTrash aria-hidden className="size-4" stroke={1.75} />
                  {t("remove")}
                </Button>
              </div>
              {render(item, index)}
            </motion.div>
          </motion.div>
        ))}
      </AnimatePresence>
      <Button variant="secondary" onClick={onAdd} className="self-start">
        <IconPlus aria-hidden className="size-4.5" stroke={1.75} />
        {addLabel}
      </Button>
    </div>
  );
}

function ExpensesField({
  expenses,
  onChange,
  message,
}: {
  expenses: Expense[];
  onChange: (expenses: Expense[]) => void;
  message: (path: string) => string | undefined;
}) {
  const t = useTranslations("report.form");
  const types = useTranslations("staff.trips.detail.report.expenseTypes");
  return (
    <Repeated
      title={t("expenses")}
      addLabel={t("addExpense")}
      items={expenses}
      onAdd={() =>
        onChange([...expenses, { key: crypto.randomUUID(), type: "", amount: "", notes: "" }])
      }
      onRemove={(key) => onChange(expenses.filter((expense) => expense.key !== key))}
      label={(index) => t("expense", { number: index + 1 })}
      render={(expense, index) => {
        const update = (change: Partial<Expense>) =>
          onChange(
            expenses.map((item) => (item.key === expense.key ? { ...item, ...change } : item)),
          );
        return (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("expenseType")} error={message(`expenses.${index}.type`)}>
                <Select
                  value={expense.type}
                  placeholder="–"
                  onChange={(event) => update({ type: event.target.value as ExpenseType })}
                >
                  {driverExpenses.map((type) => (
                    <option key={type} value={type}>
                      {types(type)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("amount")} error={message(`expenses.${index}.amount`)}>
                <MoneyInput
                  value={expense.amount}
                  onChange={(event) => update({ amount: event.target.value })}
                />
              </Field>
            </div>
            <NoteField value={expense.notes} onChange={(notes) => update({ notes })} />
          </>
        );
      }}
    />
  );
}

// A note is optional, so it stays a link until it's wanted. "Add a note" opens the box above it and turns into
// "Cancel", which closes the box and drops what was in it.
function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations("report.form");
  const id = useId();
  const [open, setOpen] = useState(value !== "");
  const toggle = () => {
    if (open) onChange("");
    setOpen(!open);
  };
  return (
    <div className="flex flex-col">
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="note" {...grow} className="overflow-hidden">
            <motion.div {...settle} className="flex origin-top flex-col gap-1.5 pb-2">
              <label htmlFor={id} className="text-sm font-medium text-foreground">
                {t("notes")}
              </label>
              <Textarea
                id={id}
                rows={2}
                autoFocus
                value={value}
                onChange={(event) => onChange(event.target.value)}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1 self-start rounded-md text-sm font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open ? "text-muted hover:text-foreground" : "text-primary hover:text-primary-hover",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={open ? "cancel" : "add"}
            {...fade}
            className="inline-flex items-center gap-1"
          >
            {open ? (
              t("cancelNote")
            ) : (
              <>
                <IconPlus aria-hidden className="size-4" stroke={2} />
                {t("addNote")}
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
