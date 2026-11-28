import { AdminFrame } from "@/components/admin/AdminFrame";

export default function PanelLayout({ children }: LayoutProps<"/admin">) {
  return <AdminFrame>{children}</AdminFrame>;
}
