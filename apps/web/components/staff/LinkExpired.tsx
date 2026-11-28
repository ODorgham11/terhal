"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/Button";
import { staffRoutes } from "@/lib/session/routes";
import { AuthCard, AuthIcon } from "./AuthCard";

// An invitation or reset link that's used, revoked or expired. `message` is the API's reason, in the page's language.
export function LinkExpired({ message }: { message?: string }) {
  const t = useTranslations("staff.auth.linkExpired");

  return (
    <AuthCard
      icon={
        <AuthIcon tone="warning">
          <IconAlertTriangle className="size-5.5" stroke={1.75} />
        </AuthIcon>
      }
      title={t("title")}
      description={message ?? t("description")}
    >
      <div className="flex flex-col gap-3">
        <Button asChild className="w-full">
          <Link href={staffRoutes.forgotPassword}>{t("newResetLink")}</Link>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <Link href={staffRoutes.signIn}>{t("backToSignIn")}</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
