"use client";

import { useTranslations } from "next-intl";
import { RequireStaff } from "@/components/session/RequireSession";
import { TeamScreen } from "@/components/staff/team/TeamScreen";
import { teamApiOf } from "@/components/staff/team/teamApi";

const api = teamApiOf("staff");

export function TeamPage() {
  const t = useTranslations("staff.team");
  return (
    <RequireStaff permission="team">
      {(staff) => (
        <TeamScreen api={api} meId={staff.id} title={t("title")} description={t("description")} />
      )}
    </RequireStaff>
  );
}
