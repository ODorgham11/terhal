"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { IconMail } from "@tabler/icons-react";
import type { StaffPermission } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { PermissionSwitches } from "./PermissionSwitches";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onSent?: () => void };

export function InviteDialog({ open, onOpenChange, onSent }: Props) {
  const t = useTranslations("staff.team.invite");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} className="max-w-lg">
        {open && (
          <InviteForm
            onSent={() => {
              onOpenChange(false);
              onSent?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ onSent }: { onSent: () => void }) {
  const t = useTranslations("staff.team.invite");
  const fields = useTranslations("common.fields");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<StaffPermission[]>(["trips"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim()) && permissions.length > 0;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = await call(
        staffApi.invitations.$post({ json: { email: email.trim(), permissions } }),
      );
      await client.invalidateQueries({ queryKey: ["staff", "invitations"] });
      toast.success(t("sent", { email: sent.email }));
      onSent();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      <Field label={fields("email")}>
        <Input
          type="email"
          dir="ltr"
          autoComplete="off"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          startAdornment={<IconMail aria-hidden className="size-4.5" stroke={1.75} />}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">{t("access")}</p>
        <PermissionSwitches value={permissions} onChange={setPermissions} />
        {permissions.length === 0 && <p className="text-xs text-danger">{t("pickOne")}</p>}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button onClick={send} loading={busy} disabled={!valid}>
          <IconMail aria-hidden className="size-5" stroke={1.75} />
          {t("submit")}
        </Button>
      </DialogFooter>
    </div>
  );
}
