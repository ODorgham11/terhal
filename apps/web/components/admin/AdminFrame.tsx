"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { IconLogout } from "@tabler/icons-react";
import { AppShell } from "@/components/AppShell";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireAdmin } from "@/components/session/RequireSession";
import { Button } from "@/components/ui/Button";
import { useSignOut } from "@/lib/session/useSignOut";

// The signed-in admin panel: the shared header with who's signed in and a way out.
export function AdminFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("admin");
  const signOut = useSignOut("admin");
  return (
    <RequireAdmin>
      {(admin) => (
        <AppShell
          title={t("title")}
          actions={
            <>
              <span className="hidden text-sm text-muted sm:inline">
                {admin.firstName} {admin.lastName}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                <DirectionalIcon icon={IconLogout} className="size-4" stroke={1.75} />
                {t("signOut")}
              </Button>
            </>
          }
        >
          {children}
        </AppShell>
      )}
    </RequireAdmin>
  );
}
