import type { ComponentProps, ReactNode } from "react";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import { cn } from "@/lib/cn";
import type { Tone } from "./Badge";

type AlertTone = Exclude<Tone, "neutral">;

const styles: Record<AlertTone, { box: string; icon: typeof IconInfoCircle }> = {
  info: { box: "border-info/30 bg-info-soft text-info", icon: IconInfoCircle },
  success: { box: "border-success/30 bg-success-soft text-success", icon: IconCircleCheck },
  warning: { box: "border-warning/30 bg-warning-soft text-warning", icon: IconAlertTriangle },
  danger: { box: "border-danger/30 bg-danger-soft text-danger", icon: IconAlertCircle },
};

type AlertProps = Omit<ComponentProps<"div">, "title"> & {
  tone?: AlertTone;
  title?: ReactNode;
};

// A message in the flow of the page: a form's error, a warning above a table. Danger alerts are announced at once
// (role="alert"); the others politely.
export function Alert({ tone = "info", title, className, children, ...props }: AlertProps) {
  const { box, icon: Icon } = styles[tone];

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border p-3 text-sm", box, className)}
      {...props}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-foreground/80">{children}</div>}
      </div>
    </div>
  );
}
