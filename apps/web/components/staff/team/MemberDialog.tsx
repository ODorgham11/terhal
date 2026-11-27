"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { IconBan, IconRestore } from "@tabler/icons-react";
import type { StaffPermission, TeamMember } from "@terhal/contracts";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { PermissionSwitches } from "./PermissionSwitches";

type Props = { member: TeamMember | null; onOpenChange: (open: boolean) => void };

// A colleague's access, and suspending or restoring it.
export function MemberDialog({ member, onOpenChange }: Props) {
  const t = useTranslations("staff.team.member");
  const format = useFormatter();
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      {member && (
        <DialogContent
          title={`${member.firstName} ${member.lastName}`}
          description={`${member.email} · ${t("since", { date: format.dateTime(new Date(member.createdAt), { month: "short", year: "numeric" }) })}`}
          className="max-w-lg"
        >
          <MemberForm key={member.id} member={member} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function MemberForm({ member, onDone }: { member: TeamMember; onDone: () => void }) {
  const t = useTranslations("staff.team.member");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [permissions, setPermissions] = useState<StaffPermission[]>(member.permissions);
  const [busy, setBusy] = useState<"save" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const suspended = member.status === "SUSPENDED";

  const run = async (which: "save" | "status", action: () => Promise<unknown>, message: string) => {
    setBusy(which);
    setError(null);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["staff", "team"] });
      toast.success(message);
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  };
  const param = { param: { id: member.id } };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger" title={error} />}
      <PermissionSwitches value={permissions} onChange={setPermissions} />
      <div className="flex items-center justify-between gap-4 rounded-xl border border-border px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {suspended ? t("reactivateTitle") : t("suspendTitle")}
          </span>
          <span className="text-xs text-muted">
            {suspended ? t("reactivateHint") : t("suspendHint")}
          </span>
        </div>
        {suspended ? (
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "status"}
            onClick={() =>
              void run(
                "status",
                () => call(staffApi.team[":id"].reactivate.$post(param)),
                t("reactivated"),
              )
            }
          >
            <IconRestore aria-hidden className="size-4" stroke={1.75} />
            {t("reactivate")}
          </Button>
        ) : (
          <Button
            variant="danger"
            size="sm"
            loading={busy === "status"}
            onClick={() =>
              void run(
                "status",
                () => call(staffApi.team[":id"].suspend.$post(param)),
                t("suspended"),
              )
            }
          >
            <IconBan aria-hidden className="size-4" stroke={1.75} />
            {t("suspend")}
          </Button>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button
          loading={busy === "save"}
          disabled={permissions.length === 0}
          onClick={() =>
            void run(
              "save",
              () =>
                call(staffApi.team[":id"].permissions.$put({ ...param, json: { permissions } })),
              t("saved"),
            )
          }
        >
          {t("save")}
        </Button>
      </DialogFooter>
    </div>
  );
}
