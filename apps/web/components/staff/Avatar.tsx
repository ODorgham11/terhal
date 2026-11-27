import { cn } from "@/lib/cn";

// A person's initials on a copper disc: the staff member in the sidebar, a driver or a customer in a list.
export function Avatar({
  firstName,
  lastName,
  className,
}: {
  firstName: string;
  lastName?: string;
  className?: string;
}) {
  const initials = `${firstName.charAt(0)}${lastName?.charAt(0) ?? ""}`;

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-medium text-primary",
        className,
      )}
    >
      {initials}
    </span>
  );
}
