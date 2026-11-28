"use client";

import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "motion/react";
import { TeamScreen } from "@/components/staff/team/TeamScreen";
import { teamApiOf } from "@/components/staff/team/teamApi";
import { Alert } from "@/components/ui/Alert";
import { fade } from "@/components/ui/Motion";

const api = teamApiOf("admin");

// The company's staff and open invitations, on the same screen as the dashboard's Team page. Admins invite the first
// staff member; after that, staff with the team permission invite the rest from the dashboard.
export function StaffPage() {
  const t = useTranslations("admin.staff");
  return (
    <TeamScreen
      api={api}
      title={t("title")}
      description={t("description")}
      notice={(members) => (
        <AnimatePresence initial={false}>
          {members === 0 && (
            <motion.div key="first" {...fade}>
              <Alert tone="info" title={t("firstTitle")}>
                {t("firstBody")}
              </Alert>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    />
  );
}
