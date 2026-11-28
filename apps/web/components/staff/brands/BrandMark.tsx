import { cn } from "@/lib/cn";

// A brand's initials on a dark tile, until logos can be uploaded.
export function BrandMark({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg bg-foreground text-xs font-semibold text-accent",
        className,
      )}
    >
      {initials}
    </span>
  );
}
