"use client";

import { useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { IconEye, IconEyeOff, IconLock } from "@tabler/icons-react";
import { Input } from "./Input";

// A password box with a lock at the start (unless `lock={false}`, as on the plain signed-out pages) and a show/hide
// toggle at the end.
//
//   <FormField name="password" label={fields("password")}><PasswordInput autoComplete="current-password" {...form.register("password")} /></FormField>
export function PasswordInput({
  lock = true,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & { lock?: boolean }) {
  const t = useTranslations("common.ui");
  const [visible, setVisible] = useState(false);
  const Toggle = visible ? IconEyeOff : IconEye;

  return (
    <Input
      {...props}
      type={visible ? "text" : "password"}
      startAdornment={
        lock ? <IconLock aria-hidden className="size-4.5" stroke={1.75} /> : undefined
      }
      endAdornment={
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          aria-pressed={visible}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Toggle aria-hidden className="size-4.5" stroke={1.75} />
        </button>
      }
    />
  );
}
