import { staffPermissions, type StaffPermission } from "@terhal/contracts";
import { adminApi, call, staffApi } from "@/lib/api";

// The team screens' requests, one set per side: the staff dashboard's Team page (staff with the team permission) and
// the admin panel's Staff page. Both see the same members and invitations and can do the same things to them, so they
// share one screen and differ only here.
export function teamApiOf(side: "staff" | "admin") {
  if (side === "staff") {
    return {
      membersKey: ["staff", "team"],
      invitationsKey: ["staff", "invitations"],
      // A colleague usually starts with trips; an admin's first invite needs everything, team included.
      defaultPermissions: ["trips"] as StaffPermission[],
      members: () => call(staffApi.team.$get({ query: {} })),
      invitations: () => call(staffApi.invitations.$get()),
      invite: (email: string, permissions: StaffPermission[]) =>
        call(staffApi.invitations.$post({ json: { email, permissions } })),
      resend: (id: string) => call(staffApi.invitations[":id"].resend.$post({ param: { id } })),
      revoke: (id: string) => call(staffApi.invitations[":id"].$delete({ param: { id } })),
      setPermissions: (id: string, permissions: StaffPermission[]) =>
        call(staffApi.team[":id"].permissions.$put({ param: { id }, json: { permissions } })),
      suspend: (id: string) => call(staffApi.team[":id"].suspend.$post({ param: { id } })),
      reactivate: (id: string) => call(staffApi.team[":id"].reactivate.$post({ param: { id } })),
      remove: (id: string) => call(staffApi.team[":id"].$delete({ param: { id } })),
    };
  }
  return {
    membersKey: ["admin", "staff", "list"],
    invitationsKey: ["admin", "staff", "invitations"],
    defaultPermissions: [...staffPermissions] as StaffPermission[],
    members: () => call(adminApi.staff.$get({ query: {} })),
    invitations: () => call(adminApi.staff.invitations.$get()),
    invite: (email: string, permissions: StaffPermission[]) =>
      call(adminApi.staff.invitations.$post({ json: { email, permissions } })),
    resend: (id: string) => call(adminApi.staff.invitations[":id"].resend.$post({ param: { id } })),
    revoke: (id: string) => call(adminApi.staff.invitations[":id"].$delete({ param: { id } })),
    setPermissions: (id: string, permissions: StaffPermission[]) =>
      call(adminApi.staff[":id"].permissions.$put({ param: { id }, json: { permissions } })),
    suspend: (id: string) => call(adminApi.staff[":id"].suspend.$post({ param: { id } })),
    reactivate: (id: string) => call(adminApi.staff[":id"].reactivate.$post({ param: { id } })),
    remove: (id: string) => call(adminApi.staff[":id"].$delete({ param: { id } })),
  };
}

export type TeamApi = ReturnType<typeof teamApiOf>;
