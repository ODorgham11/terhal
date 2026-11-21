"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { toLatinDigits } from "@/lib/digits";
import { useFieldControl } from "./Field";

type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  // Called once every box is filled, e.g. to submit.
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  name?: string;
  className?: string;
};

// A one-time code (an emailed verification code, an authenticator code), one box per digit. Typing moves to the next
// box, Backspace to the previous one, and pasting or the phone's autofill fills them all. The digits always run left to
// right, as codes are read, even on an Arabic page. Controlled, so in a form wrap it in a Controller:
//
//   <Controller control={form.control} name="code" render={({ field }) => (
//     <Field label={t("code")} error={errors.code?.message}>
//       <CodeInput value={field.value} onChange={field.onChange} onComplete={() => submit()} />
//     </Field>
//   )} />
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  autoFocus,
  id,
  name,
  className,
}: CodeInputProps) {
  const t = useTranslations("common.ui");
  const field = useFieldControl({ id });
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.slice(0, length);

  const focus = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(index, length - 1))];
    box?.focus();
    box?.select();
  };

  // Writes `typed` from box `index` on, so one digit or a whole pasted code both work.
  const fill = (index: number, typed: string) => {
    const incoming = toLatinDigits(typed).replace(/\D/g, "");
    if (!incoming) return;

    const next = (digits.slice(0, index) + incoming + digits.slice(index + incoming.length)).slice(
      0,
      length,
    );
    onChange(next);
    focus(index + incoming.length);
    if (next.length === length) onComplete?.(next);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      // Clears this box, or the one before it when this one is already empty.
      const target = digits[index] ? index : index - 1;
      if (target < 0) return;
      onChange(digits.slice(0, target) + digits.slice(target + 1));
      focus(target);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + 1);
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    fill(index, event.clipboardData.getData("text"));
  };

  return (
    <div
      dir="ltr"
      role="group"
      aria-describedby={field["aria-describedby"]}
      className={cn("flex gap-2", className)}
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          id={index === 0 ? field.id : undefined}
          name={index === 0 ? name : undefined}
          value={digits[index] ?? ""}
          onChange={(event) => {
            fill(index, event.target.value);
          }}
          onKeyDown={(event) => {
            onKeyDown(index, event);
          }}
          onPaste={(event) => {
            onPaste(index, event);
          }}
          // Never leave a gap: clicking a box past the first empty one goes to the first empty one.
          onFocus={(event) => {
            if (index > digits.length) focus(digits.length);
            else event.target.select();
          }}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          aria-label={t("codeDigit", { position: index + 1, length })}
          aria-invalid={field["aria-invalid"]}
          className="size-11 rounded-lg border border-input bg-surface text-center text-lg font-semibold text-foreground tabular-nums transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none disabled:opacity-60 aria-invalid:border-danger sm:size-12"
        />
      ))}
    </div>
  );
}
