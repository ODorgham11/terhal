"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconBan,
  IconDotsVertical,
  IconMail,
  IconPencil,
  IconRestore,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { staffPermissions, type StaffPermission, type TeamMember } from "@terhal/contracts";
import { PermissionChips, PermissionSwitches } from "@/components/staff/team/PermissionSwitches";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { adminApi, call, useErrorMessage } from "@/lib/api";

const staffKey = ["admin", "staff"] as const;

// The company's staff and open invitations. Admins invite the first staff member; after that, staff with the team
// permission invite the rest from the dashboard.
export function StaffPage() {
  const t = useTranslations("admin.staff");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const staff = useQuery({
    queryKey: [...staffKey, "list"],
    queryFn: () => call(adminApi.staff.$get({ query: {} })),
  });
  const invitations = useQuery({
    queryKey: [...staffKey, "invitations"],
    queryFn: () => call(adminApi.staff.invitations.$get()),
  });
  const members = staff.data?.data.filter((member) => member.status !== "DELETED");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setInviting(true)}>
            <IconMail aria-hidden className="size-5" stroke={1.75} />
            {t("invite")}
          </Button>
        }
      />
      {members?.length === 0 && (
        <Alert tone="info" title={t("firstTitle")}>
          {t("firstBody")}
        </Alert>
      )}
      <Members query={staff} rows={members} onEdit={setEditing} />
      <Invitations query={invitations} />
      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <PermissionsDialog member={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  );
}

function Members({
  query,
  rows,
  onEdit,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown };
  rows: TeamMember[] | undefined;
  onEdit: (member: TeamMember) => void;
}) {
  const t = useTranslations("admin.staff");
  const statuses = useTranslations("staff.team.statuses");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const columns = 4;

  const setActive = async (member: TeamMember, active: boolean) => {
    try {
      const param = { param: { id: member.id } };
      if (active) await call(adminApi.staff[":id"].reactivate.$post(param));
      else await call(adminApi.staff[":id"].suspend.$post(param));
      await client.invalidateQueries({ queryKey: staffKey });
      toast.success(active ? t("reactivated") : t("suspended"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">{t("members")}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.member")}</TableHead>
            <TableHead>{t("columns.access")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isPending ? (
            <TableLoading columns={columns} />
          ) : query.isError || !rows ? (
            <TableEmpty columns={columns} title={errorMessage(query.error)} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={columns} title={t("noMembers")} />
          ) : (
            rows.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {member.firstName} {member.lastName}
                    </span>
                    <span className="text-xs text-muted" dir="ltr">
                      {member.email}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <PermissionChips permissions={member.permissions} />
                </TableCell>
                <TableCell>
                  <Badge tone={member.status === "ACTIVE" ? "success" : "danger"} dot>
                    {statuses(member.status)}
                  </Badge>
                </TableCell>
                <TableCell className="w-11 px-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("menu", { name: member.firstName })}
                      >
                        <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => onEdit(member)}>
                        <IconPencil aria-hidden className="size-4" stroke={1.75} />
                        {t("editAccess")}
                      </DropdownMenuItem>
                      {member.status === "SUSPENDED" ? (
                        <DropdownMenuItem onSelect={() => void setActive(member, true)}>
                          <IconRestore aria-hidden className="size-4" stroke={1.75} />
                          {t("reactivate")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          destructive
                          onSelect={() => void setActive(member, false)}
                        >
                          <IconBan aria-hidden className="size-4" stroke={1.75} />
                          {t("suspend")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

type InvitationRow = {
  id: string;
  email: string;
  permissions: StaffPermission[];
  expiresAt: string;
};

function Invitations({
  query,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data?: { data: InvitationRow[] } };
}) {
  const t = useTranslations("admin.staff");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const columns = 4;

  const act = async (invitation: InvitationRow, action: "resend" | "revoke") => {
    try {
      const param = { param: { id: invitation.id } };
      if (action === "resend") await call(adminApi.staff.invitations[":id"].resend.$post(param));
      else await call(adminApi.staff.invitations[":id"].$delete(param));
      await client.invalidateQueries({ queryKey: staffKey });
      toast.success(action === "resend" ? t("resent", { email: invitation.email }) : t("revoked"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">{t("invitations")}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.email")}</TableHead>
            <TableHead>{t("columns.access")}</TableHead>
            <TableHead>{t("columns.expires")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isPending ? (
            <TableLoading columns={columns} />
          ) : query.isError || !query.data ? (
            <TableEmpty columns={columns} title={errorMessage(query.error)} />
          ) : query.data.data.length === 0 ? (
            <TableEmpty columns={columns} title={t("noInvitations")} />
          ) : (
            query.data.data.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="text-sm" dir="ltr">
                  {invitation.email}
                </TableCell>
                <TableCell>
                  <PermissionChips permissions={invitation.permissions} />
                </TableCell>
                <TableCell className="text-sm text-muted">
                  {new Date(invitation.expiresAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="w-11 px-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("menu", { name: invitation.email })}
                      >
                        <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => void act(invitation, "resend")}>
                        <IconSend aria-hidden className="size-4" stroke={1.75} />
                        {t("resend")}
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => void act(invitation, "revoke")}>
                        <IconX aria-hidden className="size-4" stroke={1.75} />
                        {t("revoke")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("admin.staff.inviteDialog");
  const fields = useTranslations("common.fields");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  // The first staff member usually needs everything, team included, to invite the rest.
  const [permissions, setPermissions] = useState<StaffPermission[]>([...staffPermissions]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const sent = await call(
        adminApi.staff.invitations.$post({ json: { email: email.trim(), permissions } }),
      );
      await client.invalidateQueries({ queryKey: staffKey });
      toast.success(t("sent", { email: sent.email }));
      setEmail("");
      onOpenChange(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("title")} description={t("description")} className="max-w-lg">
        <div className="flex flex-col gap-4">
          {error && <Alert tone="danger" title={error} />}
          <Field label={fields("email")}>
            <Input
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <PermissionSwitches value={permissions} onChange={setPermissions} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DialogClose>
            <Button
              onClick={() => void send()}
              loading={busy}
              disabled={!/^\S+@\S+\.\S+$/.test(email.trim()) || permissions.length === 0}
            >
              {t("submit")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PermissionsDialog({
  member,
  onOpenChange,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      {member && (
        <DialogContent
          title={`${member.firstName} ${member.lastName}`}
          description={member.email}
          className="max-w-lg"
        >
          <AccessForm key={member.id} member={member} onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function AccessForm({ member, onDone }: { member: TeamMember; onDone: () => void }) {
  const t = useTranslations("admin.staff.accessDialog");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [permissions, setPermissions] = useState<StaffPermission[]>(member.permissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(
        adminApi.staff[":id"].permissions.$put({ param: { id: member.id }, json: { permissions } }),
      );
      await client.invalidateQueries({ queryKey: staffKey });
      toast.success(t("saved"));
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
      <PermissionSwitches value={permissions} onChange={setPermissions} />
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">{t("cancel")}</Button>
        </DialogClose>
        <Button onClick={() => void save()} loading={busy} disabled={permissions.length === 0}>
          {t("save")}
        </Button>
      </DialogFooter>
    </div>
  );
}
