"use client";

import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { call, staffApi, useErrorMessage } from "@/lib/api";

type Kind = "drivers" | "vehicles" | "offices";

const detailKeys = { drivers: "driver", vehicles: "vehicle", offices: "office" } as const;

// Archive or restore a driver, vehicle or office, then refresh its page and its list. The API refuses to archive one
// with live trips; that shows as a toast.
export function useArchive(kind: Kind) {
  const common = useTranslations("staff.common");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();

  return async (id: string, archived: boolean) => {
    try {
      const action = archived ? "restore" : "archive";
      const param = { param: { id } };
      const saved =
        kind === "drivers"
          ? await call(staffApi.drivers[":id"][action].$post(param))
          : kind === "vehicles"
            ? await call(staffApi.vehicles[":id"][action].$post(param))
            : await call(staffApi.offices[":id"][action].$post(param));
      // An office's page holds its drivers, vehicles and trips too, which the answer doesn't: reload it instead.
      if (kind === "offices") await client.invalidateQueries({ queryKey: ["staff", "office", id] });
      else client.setQueryData(["staff", detailKeys[kind], id], saved);
      await client.invalidateQueries({ queryKey: ["staff", kind] });
      toast.success(archived ? common("restoredToast") : common("archivedToast"));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
}
