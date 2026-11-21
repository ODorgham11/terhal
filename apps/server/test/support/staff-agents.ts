import { staffPermissions, type StaffPermission } from "@terhal/contracts";
import { STAFF_PASSWORD, createStaff } from "./factories";
import { DASHBOARD_ORIGIN, createAgent } from "./http";

// A staff member holding these permissions, signed in to the dashboard.
export const signedInStaff = async (
  permissions: StaffPermission[] = [...staffPermissions],
  email = `staff.${permissions.join("-") || "none"}@terhal.co`,
) => {
  const staff = await createStaff(email, permissions);
  const agent = createAgent(DASHBOARD_ORIGIN);
  const response = await agent.request("/v1/staff/auth/sign-in", {
    method: "POST",
    json: { email, password: STAFF_PASSWORD },
  });
  if (response.status !== 200) throw new Error(`Couldn't sign in as ${email}.`);
  return { staff, agent };
};
