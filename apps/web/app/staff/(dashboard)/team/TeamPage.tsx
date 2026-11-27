"use client";

import { useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconDotsVertical,
  IconMail,
  IconPencil,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import type { Staff, StaffInvitation, TeamMember } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { Avatar } from "@/components/staff/Avatar";
import { ConfirmDialog } from "@/components/staff/ConfirmDialog";
import { InviteDialog } from "@/components/staff/team/InviteDialog";
import { MemberDialog } from "@/components/staff/team/MemberDialog";
import { PermissionChips } from "@/components/staff/team/PermissionSwitches";
import { useTripDates } from "@/components/staff/trips/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function TeamPage() {
  return <RequireStaff permission="team">{(staff) => <Team me={staff} />}</RequireStaff>;
}

type Tab = "members" | "invitations";

function Team({ me }: { me: Staff }) {
  const t = useTranslations("staff.team");
  const [tab, setTab] = useState<Tab>("members");
  const [inviting, setInviting] = useState(false);
  const members = useQuery({
    queryKey: ["staff", "team"],
    queryFn: () => call(staffApi.team.$get({ query: {} })),
  });
  const invitations = useQuery({
    queryKey: ["staff", "invitations"],
    queryFn: () => call(staffApi.invitations.$get()),
  });
  const live = members.data?.data.filter((member) => member.status !== "DELETED");
  const count = (value: number | undefined) =>
    value !== undefined && <span className="ms-1.5 text-xs text-muted">{value}</span>;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setInviting(true)}>
            <IconMail aria-hidden className="size-5" stroke={1.75} />
            {t("inviteMember")}
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="members">
            {t("members")}
            {count(live?.length)}
          </TabsTrigger>
          <TabsTrigger value="invitations">
            {t("invitations")}
            {count(invitations.data?.data.length)}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "members" ? (
        <Members me={me} query={members} rows={live} />
      ) : (
        <Invitations query={invitations} onInvite={() => setInviting(true)} />
      )}
      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onSent={() => setTab("invitations")}
      />
    </>
  );
}

function Members({
  me,
  query,
  rows,
}: {
  me: Staff;
  query: { isPending: boolean; isError: boolean; error: unknown };
  rows: TeamMember[] | undefined;
}) {
  const t = useTranslations("staff.team");
  const list = useTranslations("staff.list");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const columns = 5;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.member")}</TableHead>
            <TableHead>{t("columns.access")}</TableHead>
            <TableHead>{t("columns.lastActive")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>
              <span className="sr-only">{list("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isPending ? (
            <TableLoading columns={columns} />
          ) : query.isError || !rows ? (
            <TableEmpty columns={columns} title={errorMessage(query.error)} />
          ) : (
            rows.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isMe={member.id === me.id}
                onEdit={() => setEditing(member)}
                onRemove={() => setRemoving(member)}
              />
            ))
          )}
        </TableBody>
      </Table>
      <MemberDialog member={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("removeTitle", {
          name: removing ? `${removing.firstName} ${removing.lastName}` : "",
        })}
        description={t("removeDescription")}
        confirmLabel={t("remove")}
        tone="danger"
        onConfirm={async () => {
          if (!removing) return;
          await call(staffApi.team[":id"].$delete({ param: { id: removing.id } }));
          await client.invalidateQueries({ queryKey: ["staff", "team"] });
          toast.success(t("removed"));
        }}
      />
    </>
  );
}

function MemberRow({
  member,
  isMe,
  onEdit,
  onRemove,
}: {
  member: TeamMember;
  isMe: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("staff.team");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const suspended = member.status === "SUSPENDED";
  const lastActive = member.lastLoginAt ? new Date(member.lastLoginAt) : null;

  return (
    <TableRow className={cn(suspended && "opacity-70")}>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar firstName={member.firstName} lastName={member.lastName} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {member.firstName} {member.lastName}
              {isMe && <span className="ms-1.5 text-xs font-normal text-muted">{t("you")}</span>}
            </span>
            <span className="truncate text-xs text-muted" dir="ltr">
              {member.email}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <PermissionChips permissions={member.permissions} />
      </TableCell>
      <TableCell className="text-sm text-muted">
        {lastActive ? format.relativeTime(lastActive, now) : t("never")}
      </TableCell>
      <TableCell>
        <Badge tone={suspended ? "danger" : "success"} dot>
          {t(`statuses.${member.status}`)}
        </Badge>
      </TableCell>
      <TableCell className="w-11 px-2">
        {!isMe && (
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
              <DropdownMenuItem onSelect={onEdit}>
                <IconPencil aria-hidden className="size-4" stroke={1.75} />
                {t("editAccess")}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={onRemove}>
                <IconTrash aria-hidden className="size-4" stroke={1.75} />
                {t("remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

function Invitations({
  query,
  onInvite,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data?: { data: StaffInvitation[] };
  };
  onInvite: () => void;
}) {
  const t = useTranslations("staff.team");
  const list = useTranslations("staff.list");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const { day } = useTripDates();
  const [revoking, setRevoking] = useState<StaffInvitation | null>(null);
  const columns = 5;

  const resend = async (invitation: StaffInvitation) => {
    try {
      await call(staffApi.invitations[":id"].resend.$post({ param: { id: invitation.id } }));
      await client.invalidateQueries({ queryKey: ["staff", "invitations"] });
      toast.success(t("resent", { email: invitation.email }));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.email")}</TableHead>
            <TableHead>{t("columns.access")}</TableHead>
            <TableHead>{t("columns.invitedBy")}</TableHead>
            <TableHead>{t("columns.expires")}</TableHead>
            <TableHead>
              <span className="sr-only">{list("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isPending ? (
            <TableLoading columns={columns} />
          ) : query.isError || !query.data ? (
            <TableEmpty columns={columns} title={errorMessage(query.error)} />
          ) : query.data.data.length === 0 ? (
            <TableEmpty
              columns={columns}
              title={t("noInvitations")}
              description={t("noInvitationsHint")}
              action={
                <Button variant="secondary" size="sm" onClick={onInvite}>
                  {t("inviteMember")}
                </Button>
              }
            />
          ) : (
            query.data.data.map((invitation) => (
              <TableRow key={invitation.id}>
                <TableCell className="text-sm font-medium" dir="ltr">
                  {invitation.email}
                </TableCell>
                <TableCell>
                  <PermissionChips permissions={invitation.permissions} />
                </TableCell>
                <TableCell className="text-sm text-muted">
                  {invitation.invitedBy?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted">{day(invitation.expiresAt)}</TableCell>
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
                      <DropdownMenuItem onSelect={() => void resend(invitation)}>
                        <IconSend aria-hidden className="size-4" stroke={1.75} />
                        {t("resend")}
                      </DropdownMenuItem>
                      <DropdownMenuItem destructive onSelect={() => setRevoking(invitation)}>
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
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("revokeTitle")}
        description={t("revokeDescription", { email: revoking?.email ?? "" })}
        confirmLabel={t("revoke")}
        tone="danger"
        onConfirm={async () => {
          if (!revoking) return;
          await call(staffApi.invitations[":id"].$delete({ param: { id: revoking.id } }));
          await client.invalidateQueries({ queryKey: ["staff", "invitations"] });
          toast.success(t("revoked"));
        }}
      />
    </>
  );
}
