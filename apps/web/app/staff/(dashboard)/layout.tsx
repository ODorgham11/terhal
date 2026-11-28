import { StaffFrame } from "@/components/staff/StaffShell";

// Every page behind sign-in. The sign-in, invitation and password reset pages sit outside this group.
export default function DashboardLayout({ children }: LayoutProps<"/staff">) {
  return <StaffFrame>{children}</StaffFrame>;
}
