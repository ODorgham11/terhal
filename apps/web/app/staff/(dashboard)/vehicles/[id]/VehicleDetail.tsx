"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  IconArchive,
  IconChevronLeft,
  IconChevronRight,
  IconChevronRight as IconCrumb,
  IconPencil,
  IconPhoto,
  IconRestore,
  IconStar,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import {
  VEHICLE_IMAGE_LIMIT,
  VEHICLE_IMAGE_MAX_BYTES,
  carBodies,
  carCapacity,
  vehicleImageTypes,
  type Vehicle,
} from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { RequireStaff } from "@/components/session/RequireSession";
import { InfoList, InfoRow, SectionCard } from "@/components/staff/SectionCard";
import { SystemState } from "@/components/staff/SystemState";
import { FleetTrips } from "@/components/staff/fleet/FleetTrips";
import { VehicleDrawer } from "@/components/staff/fleet/VehicleDrawer";
import { KindBadge } from "@/components/staff/fleet/format";
import { useArchive } from "@/components/staff/fleet/useArchive";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FadeText, ease, fade } from "@/components/ui/Motion";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { uploadVehiclePhoto } from "@/components/staff/fleet/uploadPhoto";
import { call, isApiError, staffApi, useErrorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";

export function VehicleDetailPage({ id }: { id: string }) {
  return <RequireStaff permission="fleet">{() => <Detail id={id} />}</RequireStaff>;
}

const vehicleKey = (id: string) => ["staff", "vehicle", id];

function Detail({ id }: { id: string }) {
  const vehicle = useQuery({
    queryKey: vehicleKey(id),
    queryFn: () => call(staffApi.vehicles[":id"].$get({ param: { id } })),
    retry: (count, error) => !(isApiError(error) && error.status === 404) && count < 1,
    // The photo links are signed for 15 minutes.
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  if (vehicle.isPending) return <VehicleLoading />;
  if (vehicle.isError) {
    return isApiError(vehicle.error) && vehicle.error.status === 404 ? (
      <SystemState kind="notFound" />
    ) : (
      <SystemState kind="error" onRetry={() => void vehicle.refetch()} />
    );
  }
  return <Loaded vehicle={vehicle.data} />;
}

function Loaded({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("staff.fleet.vehicle");
  const nav = useTranslations("staff.nav");
  const common = useTranslations("staff.common");
  const cars = useTranslations("staff.trips.car");
  const fields = useTranslations("common.fields");
  const archive = useArchive("vehicles");
  const [editing, setEditing] = useState(false);
  const archived = vehicle.archivedAt !== null;
  const name = `${vehicle.make} ${vehicle.model}${vehicle.year ? ` ${String(vehicle.year)}` : ""}`;
  const capacity = carCapacity[vehicle.body];
  const smaller = carBodies.slice(0, carBodies.indexOf(vehicle.body));

  return (
    <motion.div {...fade} className="flex flex-col gap-6">
      <nav aria-label={t("breadcrumb")} className="flex items-center gap-2 text-xs">
        <Link href="/vehicles" className="text-primary hover:underline">
          {nav("vehicles")}
        </Link>
        <DirectionalIcon icon={IconCrumb} className="size-3.5 text-muted" />
        <span className="text-muted">{name}</span>
      </nav>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
            <KindBadge item={vehicle} />
            {archived && <Badge tone="neutral">{t("archived")}</Badge>}
          </div>
          <p className="text-sm text-muted">
            <span dir="ltr">{vehicle.plateNumber}</span> · {vehicle.color} · {cars(vehicle.body)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void archive(vehicle.id, archived)}>
            {archived ? (
              <IconRestore aria-hidden className="size-5" stroke={1.75} />
            ) : (
              <IconArchive aria-hidden className="size-5" stroke={1.75} />
            )}
            {archived ? common("restore") : common("archive")}
          </Button>
          <Button onClick={() => setEditing(true)}>
            <IconPencil aria-hidden className="size-5" stroke={1.75} />
            {common("edit")}
          </Button>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Photos vehicle={vehicle} />
          <SectionCard title={t("trips")}>
            <FleetTrips filter={{ vehicleId: vehicle.id }} />
          </SectionCard>
        </div>
        <div className="flex flex-col gap-5">
          <SectionCard title={t("details")}>
            <InfoList>
              <InfoRow label={fields("make")}>{vehicle.make}</InfoRow>
              <InfoRow label={fields("model")}>{vehicle.model}</InfoRow>
              <InfoRow label={fields("year")}>{vehicle.year ?? "—"}</InfoRow>
              <InfoRow label={fields("plateNumber")}>
                <span dir="ltr">{vehicle.plateNumber}</span>
              </InfoRow>
              <InfoRow label={fields("color")}>{vehicle.color}</InfoRow>
              <InfoRow label={fields("body")}>{cars(vehicle.body)}</InfoRow>
              <InfoRow label={fields("office")}>
                {vehicle.office ? (
                  <Link href={`/offices/${vehicle.office.id}`} className="hover:underline">
                    {vehicle.office.name}
                  </Link>
                ) : (
                  t("noOffice")
                )}
              </InfoRow>
            </InfoList>
          </SectionCard>
          <SectionCard title={t("fits")}>
            <InfoList>
              <InfoRow label={t("passengers")}>{capacity.passengers}</InfoRow>
              <InfoRow label={t("largeBags")}>{capacity.largeLuggage}</InfoRow>
              <InfoRow label={t("mediumBags")}>{capacity.mediumLuggage}</InfoRow>
              <InfoRow label={t("smallBags")}>{capacity.smallLuggage}</InfoRow>
            </InfoList>
            {smaller.length > 0 && (
              <p className="text-xs text-muted">
                {t("alsoServes", { bodies: smaller.map((body) => cars(body)).join(", ") })}
              </p>
            )}
          </SectionCard>
        </div>
      </div>

      <VehicleDrawer vehicle={vehicle} open={editing} onOpenChange={setEditing} />
    </motion.div>
  );
}

// The page's own shape in gray: breadcrumb, header, the photo and trips on one side, the details on the other.
function VehicleLoading() {
  const t = useTranslations("common.ui");
  const card = (lines: number, key: number) => (
    <div
      key={key}
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-5 shadow-xs"
    >
      <div className="flex h-8 items-center">
        <Skeleton className="h-4.5 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: lines }, (_, line) => (
          <Skeleton key={line} className={line % 2 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
      </div>
    </div>
  );
  return (
    <motion.div {...fade} role="status" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <Skeleton className="h-3.5 w-36" />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-5.5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-5 shadow-xs">
            <div className="flex h-8 items-center justify-between">
              <Skeleton className="h-4.5 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex flex-col gap-4">
              <Skeleton className="aspect-[16/9] w-full rounded-lg" />
              <div className="flex gap-2">
                {[0, 1, 2].map((thumb) => (
                  <Skeleton key={thumb} className="h-14 w-20 rounded-md" />
                ))}
              </div>
            </div>
          </div>
          {card(3, 0)}
        </div>
        <div className="flex flex-col gap-5">{[7, 4].map(card)}</div>
      </div>
    </motion.div>
  );
}

// Up to five photos; the first is the cover. Upload, remove, and move one along (the cover button moves it first).
function Photos({ vehicle }: { vehicle: Vehicle }) {
  const t = useTranslations("staff.fleet.vehicle.photos");
  const errorMessage = useErrorMessage();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<
    { id: string; name: string; preview: string; progress: number; file: File }[]
  >([]);
  const uploading = pending.length > 0;
  const images = vehicle.images;
  const current = images[Math.min(selected, images.length - 1)];
  const full = images.length + pending.length >= VEHICLE_IMAGE_LIMIT;

  const run = async (request: () => Promise<Vehicle>, done?: string) => {
    setBusy(true);
    try {
      client.setQueryData(vehicleKey(vehicle.id), await request());
      await client.invalidateQueries({ queryKey: ["staff", "vehicles"] });
      if (done) toast.success(done);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  // Each file goes straight to storage (lib: uploadVehiclePhoto), shown as a tile with its progress until it's added.
  // One at a time, so they're added in the order picked.
  const upload = async (files: FileList | null) => {
    const picked = Array.from(files ?? []).slice(0, VEHICLE_IMAGE_LIMIT - images.length);
    if (input.current) input.current.value = "";
    const accepted = picked.filter((file) => {
      if (!(vehicleImageTypes as readonly string[]).includes(file.type)) {
        toast.error(t("wrongType", { name: file.name }));
        return false;
      }
      if (file.size > VEHICLE_IMAGE_MAX_BYTES) {
        toast.error(t("tooBig", { name: file.name }));
        return false;
      }
      return true;
    });
    const queued = accepted.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      preview: URL.createObjectURL(file),
      progress: 0,
      file,
    }));
    setPending((current) => [...current, ...queued]);

    let added = 0;
    for (const item of queued) {
      try {
        const saved = await uploadVehiclePhoto(vehicle.id, item.file, (progress) =>
          setPending((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, progress } : entry)),
          ),
        );
        client.setQueryData(vehicleKey(vehicle.id), saved);
        setSelected(saved.images.length - 1);
        added += 1;
      } catch (failure) {
        toast.error(errorMessage(failure));
      } finally {
        setPending((current) => current.filter((entry) => entry.id !== item.id));
        URL.revokeObjectURL(item.preview);
      }
    }
    if (added > 0) {
      await client.invalidateQueries({ queryKey: ["staff", "vehicles"] });
      toast.success(t("added", { count: added }));
    }
  };

  const move = (from: number, to: number) => {
    const ids = images.map((image) => image.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    setSelected(to);
    void run(() =>
      call(
        staffApi.vehicles[":id"].images.order.$put({
          param: { id: vehicle.id },
          json: { imageIds: ids },
        }),
      ),
    );
  };

  return (
    <SectionCard
      title={t("title")}
      aside={
        <span className="text-xs text-muted">
          <FadeText value={t("count", { count: images.length, limit: VEHICLE_IMAGE_LIMIT })} />
        </span>
      }
    >
      <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-lg bg-surface-muted text-muted">
        {/* Photos crossfade into each other as one is picked, added or removed. */}
        <AnimatePresence initial={false}>
          <motion.div
            key={current?.id ?? "none"}
            {...fade}
            className="absolute inset-0 flex items-center justify-center"
          >
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed storage links
              <img
                src={current.url}
                alt={t("photoAlt", { number: current.position + 1 })}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                <IconPhoto aria-hidden className="size-8" stroke={1.5} />
                <span className="text-sm">{t("none")}</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        {current && (
          <>
            <AnimatePresence initial={false}>
              {current.position === 0 && (
                <motion.span
                  key="cover"
                  {...fade}
                  className="absolute start-3 top-3 rounded-md bg-surface px-2 py-1 text-xs font-medium text-foreground shadow-xs"
                >
                  {t("cover")}
                </motion.span>
              )}
            </AnimatePresence>
            <div className="absolute end-3 top-3 flex gap-1.5">
              {current.position > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => move(current.position, 0)}
                >
                  <IconStar aria-hidden className="size-4" stroke={1.75} />
                  {t("makeCover")}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={t("remove")}
                onClick={() => {
                  setSelected(Math.max(0, current.position - 1));
                  void run(
                    () =>
                      call(
                        staffApi.vehicles[":id"].images[":imageId"].$delete({
                          param: { id: vehicle.id, imageId: current.id },
                        }),
                      ),
                    t("removed"),
                  );
                }}
              >
                <IconTrash aria-hidden className="size-4" stroke={1.75} />
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AnimatePresence initial={false}>
          {images.map((image, index) => (
            // Slides to its new place when the order changes, and fades in or out when added or removed.
            <motion.div
              key={image.id}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={ease}
              className="flex flex-col items-center gap-1"
            >
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={t("photoAlt", { number: index + 1 })}
                aria-pressed={current?.id === image.id}
                className={cn(
                  "h-14 w-20 overflow-hidden rounded-md border-2 transition-[border-color,opacity] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  current?.id === image.id
                    ? "border-primary"
                    : "border-transparent opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed storage links */}
                <img src={image.url} alt="" className="size-full object-cover" />
              </button>
              <AnimatePresence initial={false}>
                {current?.id === image.id && images.length > 1 && (
                  <motion.div key="move" {...fade} className="flex gap-1">
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => move(index, index - 1)}
                      aria-label={t("moveEarlier")}
                      className="rounded p-0.5 text-muted transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      <DirectionalIcon icon={IconChevronLeft} className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === images.length - 1}
                      onClick={() => move(index, index + 1)}
                      aria-label={t("moveLater")}
                      className="rounded p-0.5 text-muted transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      <DirectionalIcon icon={IconChevronRight} className="size-4" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {pending.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={ease}
              role="status"
              aria-label={t("progress", {
                name: item.name,
                percent: Math.round(item.progress * 100),
              })}
              className="relative h-14 w-20 self-start overflow-hidden rounded-md border-2 border-transparent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file */}
              <img src={item.preview} alt="" className="size-full object-cover opacity-50" />
              <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded-full bg-surface/80">
                <motion.span
                  className="block h-full origin-left rounded-full bg-primary rtl:origin-right"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: item.progress }}
                  transition={ease}
                />
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {!full && (
          <>
            <input
              ref={input}
              type="file"
              accept={vehicleImageTypes.join(",")}
              multiple
              className="sr-only"
              id="vehicle-photos"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button asChild variant="secondary" size="sm" disabled={busy || uploading}>
              <label htmlFor="vehicle-photos" className="cursor-pointer">
                <IconUpload aria-hidden className="size-4" stroke={1.75} />
                <FadeText value={uploading ? t("uploading") : t("add")} />
              </label>
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted">{t("hint", { limit: VEHICLE_IMAGE_LIMIT })}</p>
    </SectionCard>
  );
}
