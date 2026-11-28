import { IconCar } from "@tabler/icons-react";
import type { Vehicle } from "@terhal/contracts";
import { cn } from "@/lib/cn";

// The cover photo, or a car icon when there's none.
export function VehicleThumb({ vehicle, className }: { vehicle: Vehicle; className?: string }) {
  const cover = vehicle.images[0];
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-muted",
        className,
      )}
    >
      {cover ? (
        // Signed links from storage: next/image can't optimize them.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.url} alt="" className="size-full object-cover" />
      ) : (
        <IconCar aria-hidden className="size-5" stroke={1.75} />
      )}
    </span>
  );
}
