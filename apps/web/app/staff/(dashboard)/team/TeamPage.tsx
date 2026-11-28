"use client";

import { useState } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
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
import { AutoHeight, FadeText, fade } from "@/components/ui/Motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import {
  MotionTableRow,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
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
    value !== undefined && (
      <span className="ms-1.5 text-xs text-muted tabular-nums">
        <FadeText value={value} />
      </span>
    );

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

// A list's failure, on phones.
function CardsError({ message }: { message: string }) {
  return (
    <motion.li {...fade} className="py-10 text-center text-sm text-danger">
      {message}
    </motion.li>
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
  const actions = (member: TeamMember) => ({
    isMe: member.id === me.id,
    onEdit: () => setEditing(member),
    onRemove: () => setRemoving(member),
  });

  return (
    <>
      {/* Phones: one card per member. */}
      <AutoHeight className="md:hidden">
        <ul className="flex flex-col gap-3">
          {query.isPending ? (
            <MemberCardsLoading />
          ) : query.isError || !rows ? (
            <CardsError message={errorMessage(query.error)} />
          ) : (
            rows.map((member) => (
              <MemberCard key={member.id} member={member} {...actions(member)} />
            ))
          )}
        </ul>
      </AutoHeight>

      <AutoHeight className="hidden md:block">
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
              <MemberRowsLoading />
            ) : query.isError || !rows ? (
              <TableEmpty columns={columns} title={errorMessage(query.error)} />
            ) : (
              rows.map((member) => (
                <MemberRow key={member.id} member={member} {...actions(member)} />
              ))
            )}
          </TableBody>
        </Table>
      </AutoHeight>

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

type MemberProps = {
  member: TeamMember;
  isMe: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

function MemberName({ member, isMe }: { member: TeamMember; isMe: boolean }) {
  const t = useTranslations("staff.team");
  return (
    <div className="flex min-w-0 items-center gap-2.5">
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
  );
}

function useLastActive(member: TeamMember) {
  const t = useTranslations("staff.team");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return member.lastLoginAt ? format.relativeTime(new Date(member.lastLoginAt), now) : t("never");
}

function MemberStatus({ member }: { member: TeamMember }) {
  const t = useTranslations("staff.team");
  return (
    <Badge tone={member.status === "SUSPENDED" ? "danger" : "success"} dot>
      {t(`statuses.${member.status}`)}
    </Badge>
  );
}

function MemberMenu({ member, isMe, onEdit, onRemove }: MemberProps) {
  const t = useTranslations("staff.team");
  // No menu on your own row: you can't change your own access or remove yourself.
  if (isMe) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("menu", { name: member.firstName })}>
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
  );
}

function MemberRow(props: MemberProps) {
  const { member, isMe } = props;
  const lastActive = useLastActive(member);
  return (
    <MotionTableRow {...fade} className={cn(member.status === "SUSPENDED" && "opacity-70")}>
      <TableCell>
        <MemberName member={member} isMe={isMe} />
      </TableCell>
      <TableCell>
        <PermissionChips permissions={member.permissions} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted">{lastActive}</TableCell>
      <TableCell>
        <MemberStatus member={member} />
      </TableCell>
      <TableCell className="w-11 px-2">
        <MemberMenu {...props} />
      </TableCell>
    </MotionTableRow>
  );
}

function MemberCard(props: MemberProps) {
  const { member, isMe } = props;
  const lastActive = useLastActive(member);
  return (
    <motion.li
      {...fade}
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4",
        member.status === "SUSPENDED" && "opacity-70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <MemberName member={member} isMe={isMe} />
        <MemberMenu {...props} />
      </div>
      <PermissionChips permissions={member.permissions} />
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="text-xs text-muted">{lastActive}</span>
        <MemberStatus member={member} />
      </div>
    </motion.li>
  );
}

// The members loading: rows shaped like them, so nothing moves when they arrive.
function MemberRowsLoading() {
  const t = useTranslations("common.ui");
  return (
    <>
      {[0, 1, 2, 3].map((row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell>
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <SkeletonLines first={row % 2 ? "w-32" : "w-28"} second="w-40" />
            </div>
          </TableCell>
          <TableCell>
            <Chips />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5.5 w-18 rounded-full" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function MemberCardsLoading() {
  return (
    <>
      {[0, 1, 2].map((card) => (
        <motion.li
          key={card}
          {...fade}
          aria-hidden
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <SkeletonLines first="w-32" second="w-40" />
          </div>
          <Chips />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5.5 w-18 rounded-full" />
          </div>
        </motion.li>
      ))}
    </>
  );
}

// Permission chips in gray.
function Chips() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {["w-14", "w-16", "w-12"].map((width) => (
        <Skeleton key={width} className={cn("h-5.5 rounded-full", width)} />
      ))}
    </div>
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
  const actions = (invitation: StaffInvitation) => ({
    onResend: () => void resend(invitation),
    onRevoke: () => setRevoking(invitation),
  });
  const inviteButton = (
    <Button variant="secondary" size="sm" onClick={onInvite}>
      {t("inviteMember")}
    </Button>
  );

  return (
    <>
      {/* Phones: one card per invitation. */}
      <AutoHeight className="md:hidden">
        <ul className="flex flex-col gap-3">
          {query.isPending ? (
            <InvitationCardsLoading />
          ) : query.isError || !query.data ? (
            <CardsError message={errorMessage(query.error)} />
          ) : query.data.data.length === 0 ? (
            <motion.li {...fade} className="flex flex-col items-center gap-0.5 py-10 text-center">
              <span className="text-base font-semibold text-foreground">{t("noInvitations")}</span>
              <span className="text-[0.8125rem] text-muted">{t("noInvitationsHint")}</span>
              <span className="pt-4">{inviteButton}</span>
            </motion.li>
          ) : (
            query.data.data.map((invitation) => (
              <InvitationCard
                key={invitation.id}
                invitation={invitation}
                {...actions(invitation)}
              />
            ))
          )}
        </ul>
      </AutoHeight>

      <AutoHeight className="hidden md:block">
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
              <InvitationRowsLoading />
            ) : query.isError || !query.data ? (
              <TableEmpty columns={columns} title={errorMessage(query.error)} />
            ) : query.data.data.length === 0 ? (
              <TableEmpty
                columns={columns}
                title={t("noInvitations")}
                description={t("noInvitationsHint")}
                action={inviteButton}
              />
            ) : (
              query.data.data.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  {...actions(invitation)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </AutoHeight>

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

type InvitationProps = {
  invitation: StaffInvitation;
  onResend: () => void;
  onRevoke: () => void;
};

function InvitationMenu({ invitation, onResend, onRevoke }: InvitationProps) {
  const t = useTranslations("staff.team");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("menu", { name: invitation.email })}>
          <IconDotsVertical aria-hidden className="size-4.5" stroke={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onResend}>
          <IconSend aria-hidden className="size-4" stroke={1.75} />
          {t("resend")}
        </DropdownMenuItem>
        <DropdownMenuItem destructive onSelect={onRevoke}>
          <IconX aria-hidden className="size-4" stroke={1.75} />
          {t("revoke")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InvitationRow(props: InvitationProps) {
  const { invitation } = props;
  const list = useTranslations("staff.list");
  const { day } = useTripDates();
  return (
    <MotionTableRow {...fade}>
      <TableCell className="font-medium" dir="ltr">
        {invitation.email}
      </TableCell>
      <TableCell>
        <PermissionChips permissions={invitation.permissions} />
      </TableCell>
      <TableCell className="text-muted">{invitation.invitedBy?.name ?? list("none")}</TableCell>
      <TableCell className="whitespace-nowrap text-muted">{day(invitation.expiresAt)}</TableCell>
      <TableCell className="w-11 px-2">
        <InvitationMenu {...props} />
      </TableCell>
    </MotionTableRow>
  );
}

function InvitationCard(props: InvitationProps) {
  const { invitation } = props;
  const t = useTranslations("staff.team");
  const { day } = useTripDates();
  return (
    <motion.li
      {...fade}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-foreground" dir="ltr">
          {invitation.email}
        </span>
        <InvitationMenu {...props} />
      </div>
      <PermissionChips permissions={invitation.permissions} />
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
        <span>{invitation.invitedBy?.name}</span>
        <span>
          {t("columns.expires")} {day(invitation.expiresAt)}
        </span>
      </div>
    </motion.li>
  );
}

function InvitationRowsLoading() {
  const t = useTranslations("common.ui");
  return (
    <>
      {[0, 1].map((row) => (
        <motion.tr
          key={row}
          {...fade}
          className="border-b border-border"
          aria-hidden={row > 0 || undefined}
        >
          <TableCell>
            {row === 0 && <span className="sr-only">{t("loading")}</span>}
            <Skeleton className={cn("h-3.5", row % 2 ? "w-44" : "w-52")} />
          </TableCell>
          <TableCell>
            <Chips />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-3.5 w-20" />
          </TableCell>
          <TableCell className="w-11 px-2">
            <Skeleton className="size-8 rounded-lg" />
          </TableCell>
        </motion.tr>
      ))}
    </>
  );
}

function InvitationCardsLoading() {
  return (
    <>
      {[0, 1].map((card) => (
        <motion.li
          key={card}
          {...fade}
          aria-hidden
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
        >
          <Skeleton className="h-3.5 w-48" />
          <Chips />
          <div className="flex items-center justify-between border-t border-border pt-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        </motion.li>
      ))}
    </>
  );
}
