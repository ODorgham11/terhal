"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Popover } from "radix-ui";
import { DayPicker, type ChevronProps, type DateRange } from "react-day-picker";
import { arEG, enGB } from "react-day-picker/locale";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconX,
} from "@tabler/icons-react";
import { directionOf } from "@/i18n/locales";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

// Dates go in and out as "2026-11-28": a calendar day, not an instant, so the browser's time zone never moves it. The
// calendar works on local noon of that day, which every zone agrees is the same date.
const toDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : undefined;
};
const toValue = (date: Date) =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function Chevron({ orientation, className }: ChevronProps) {
  const Icon = orientation === "left" ? IconChevronLeft : IconChevronRight;
  return <Icon aria-hidden className={cn("size-4.5", className)} stroke={1.75} />;
}

// The month grid in the app's look: maroon for the chosen day, a ring for today, a soft band across a range.
function Calendar(props: React.ComponentProps<typeof DayPicker>) {
  const locale = useLocale();
  return (
    <DayPicker
      locale={locale === "ar" ? arEG : enGB}
      dir={directionOf(locale)}
      weekStartsOn={6}
      showOutsideDays
      components={{ Chevron }}
      classNames={{
        root: "relative p-3 text-sm",
        months: "flex flex-col",
        month: "flex flex-col gap-3",
        month_caption: "flex h-8 items-center px-1",
        caption_label: "text-sm font-semibold text-foreground",
        nav: "absolute end-3 top-3 flex items-center gap-1",
        button_previous:
          "inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-40",
        button_next:
          "inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-40",
        month_grid: "border-collapse",
        weekdays: "flex",
        weekday: "flex size-9 items-center justify-center text-xs font-medium text-muted",
        week: "mt-1 flex",
        day: "group/day relative size-9 p-0 text-center",
        day_button:
          "relative z-10 inline-flex size-9 items-center justify-center rounded-lg text-sm text-foreground tabular-nums transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        today: "[&>button]:font-semibold [&>button]:text-primary",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary-hover",
        range_middle:
          "bg-primary-soft [&>button]:bg-transparent [&>button]:text-primary [&>button]:hover:bg-primary/10",
        range_start: "rounded-s-lg bg-primary-soft",
        range_end: "rounded-e-lg bg-primary-soft",
        outside: "[&>button]:text-muted/50",
        disabled: "[&>button]:pointer-events-none [&>button]:text-muted/40",
        hidden: "invisible",
        ...props.classNames,
      }}
      {...props}
    />
  );
}

type TriggerProps = {
  icon?: typeof IconCalendar;
  label: ReactNode;
  placeholder: string;
  empty: boolean;
  onClear?: () => void;
  className?: string;
  ariaLabel?: string;
  field: ReturnType<typeof useFieldControl>;
};

// Looks like the text inputs, so it lines up in a form; opens the calendar or the time list.
function Trigger({
  icon: Icon = IconCalendar,
  label,
  placeholder,
  empty,
  onClear,
  className,
  ariaLabel,
  field,
}: TriggerProps) {
  const t = useTranslations("common.ui");
  return (
    <div className={cn("relative", className)}>
      <Popover.Trigger
        {...field}
        aria-label={ariaLabel}
        className={cn(
          controlClasses,
          "flex h-10 items-center gap-2 text-start data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/25",
          onClear && !empty && "pe-9",
        )}
      >
        <Icon aria-hidden className="size-4.5 shrink-0 text-muted" stroke={1.75} />
        <span className={cn("min-w-0 flex-1 truncate", empty && "text-muted")}>
          {empty ? placeholder : label}
        </span>
      </Popover.Trigger>
      {onClear && !empty && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("clear")}
          className="absolute inset-y-0 end-0 flex items-center pe-3 text-muted hover:text-foreground"
        >
          <IconX aria-hidden className="size-4" stroke={1.75} />
        </button>
      )}
    </div>
  );
}

function Content({ children }: { children: ReactNode }) {
  return (
    <Popover.Portal>
      <Popover.Content
        align="start"
        sideOffset={6}
        className="animate-pop z-50 rounded-xl border border-border bg-surface shadow-lg"
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  );
}

const useDay = () => {
  const format = useFormatter();
  return (date: Date) =>
    format.dateTime(date, {
      day: "numeric",
      month: "short",
      year: "numeric",
      // The day is local noon in this browser, so it's named in this browser's zone, not Cairo's.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
};

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  // "yyyy-mm-dd" bounds, inclusive.
  min?: string;
  max?: string;
  placeholder?: string;
  // Shows a clear button once a day is picked.
  clearable?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

// One day. Inside a Field it picks up the label and error like the other controls.
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  clearable = false,
  className,
  ...props
}: DatePickerProps) {
  const t = useTranslations("common.ui");
  const field = useFieldControl(props);
  const day = useDay();
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  const from = min ? toDate(min) : undefined;
  const to = max ? toDate(max) : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Trigger
        field={field}
        ariaLabel={props["aria-label"]}
        className={className}
        empty={!selected}
        label={selected && day(selected)}
        placeholder={placeholder ?? t("pickDate")}
        onClear={clearable ? () => onChange("") : undefined}
      />
      <Content>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? from}
          disabled={[...(from ? [{ before: from }] : []), ...(to ? [{ after: to }] : [])]}
          onSelect={(date) => {
            if (date) onChange(toValue(date));
            setOpen(false);
          }}
        />
      </Content>
    </Popover.Root>
  );
}

type DateRangePickerProps = {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
};

// A from–to pair of days in one calendar: the first click starts the range, the second ends it.
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder,
  className,
  ...props
}: DateRangePickerProps) {
  const t = useTranslations("common.ui");
  const field = useFieldControl({});
  const day = useDay();
  const [open, setOpen] = useState(false);
  const start = toDate(from);
  const end = toDate(to);
  const label =
    start && end && from !== to
      ? `${day(start)} – ${day(end)}`
      : start
        ? day(start)
        : end
          ? `– ${day(end)}`
          : "";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Trigger
        field={field}
        ariaLabel={props["aria-label"]}
        className={className}
        empty={!start && !end}
        label={label}
        placeholder={placeholder ?? t("pickDates")}
        onClear={() => onChange({ from: "", to: "" })}
      />
      <Content>
        <Calendar
          mode="range"
          selected={{ from: start, to: end } satisfies DateRange}
          defaultMonth={start ?? end}
          onSelect={(range) => {
            onChange({
              from: range?.from ? toValue(range.from) : "",
              to: range?.to ? toValue(range.to) : "",
            });
            if (range?.from && range.to && range.from.getTime() !== range.to.getTime()) {
              setOpen(false);
            }
          }}
        />
      </Content>
    </Popover.Root>
  );
}

type TimePickerProps = {
  // "08:30", 24-hour; "" while none is picked.
  value: string;
  onChange: (value: string) => void;
  // Minutes between the choices: 15 for pickups (they're on the quarter hour), 5 for what a driver reports.
  step?: number;
  placeholder?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

const pad = (value: number) => String(value).padStart(2, "0");
const local = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// A time of day: hours and minutes side by side in the calendar's look, so a date and a time read as one control.
// Picking a minute closes it.
export function TimePicker({
  value,
  onChange,
  step = 5,
  placeholder,
  className,
  ...props
}: TimePickerProps) {
  const t = useTranslations("common.ui");
  const format = useFormatter();
  const field = useFieldControl(props);
  const [open, setOpen] = useState(false);
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  const hour = match ? Number(match[1]) : null;
  const minute = match ? Number(match[2]) : null;
  const at = (h: number, m: number) => new Date(2000, 0, 1, h, m);
  const label =
    hour !== null && minute !== null
      ? format.dateTime(at(hour, minute), { hour: "numeric", minute: "2-digit", timeZone: local() })
      : "";
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, index) => index * step);
  // A stored time off the grid (09:07 with a 5-minute step) still shows, chosen.
  if (minute !== null && !minutes.includes(minute)) minutes.push(minute);
  minutes.sort((a, b) => a - b);

  const set = (h: number, m: number, close: boolean) => {
    onChange(`${pad(h)}:${pad(m)}`);
    if (close) setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Trigger
        icon={IconClock}
        field={{ ...field, "aria-invalid": props["aria-invalid"] ?? field["aria-invalid"] }}
        ariaLabel={props["aria-label"]}
        className={className}
        empty={!label}
        label={label}
        placeholder={placeholder ?? t("pickTime")}
      />
      <Content>
        <div className="flex h-64 gap-1 p-2" dir="ltr">
          <Column label={t("hours")}>
            {Array.from({ length: 24 }, (_, h) => (
              <Choice
                key={h}
                selected={h === hour}
                onClick={() => set(h, minute ?? 0, minute !== null)}
              >
                {format.dateTime(at(h, 0), { hour: "numeric", timeZone: local() })}
              </Choice>
            ))}
          </Column>
          <div aria-hidden className="w-px bg-border" />
          <Column label={t("minutes")}>
            {minutes.map((m) => (
              <Choice key={m} selected={m === minute} onClick={() => set(hour ?? 8, m, true)}>
                {format.number(m, { minimumIntegerDigits: 2 })}
              </Choice>
            ))}
          </Column>
        </div>
      </Content>
    </Popover.Root>
  );
}

// One scrolling list of choices, opened with the chosen one in view.
function Column({ label, children }: { label: string; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>("[aria-selected=true]")
      ?.scrollIntoView({ block: "center" });
  }, []);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      className="flex w-20 flex-col gap-0.5 overflow-y-auto overscroll-contain scroll-smooth pe-1"
    >
      {children}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-lg px-2 text-sm tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "bg-primary font-medium text-primary-foreground"
          : "text-foreground hover:bg-surface-muted",
      )}
    >
      {children}
    </button>
  );
}
