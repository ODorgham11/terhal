"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { Location } from "@terhal/contracts";
import { DirectionalIcon } from "@/components/DirectionalIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import { call, staffApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useLocalName } from "../trips/format";
import { locationsKey } from "./shared";

type TreeProps = { selectedId: string | null; onSelect: (location: Location) => void };

// Governorates, opening into their districts and areas. Children load when a branch is opened.
export function LocationTree({ selectedId, onSelect }: TreeProps) {
  return (
    <ul role="tree" className="flex flex-col">
      <Branch parentId={null} depth={0} selectedId={selectedId} onSelect={onSelect} />
    </ul>
  );
}

function Branch({
  parentId,
  depth,
  selectedId,
  onSelect,
}: TreeProps & { parentId: string | null; depth: number }) {
  const t = useTranslations("staff.locations");
  const children = useQuery({
    queryKey: [...locationsKey, "children", parentId],
    queryFn: () =>
      call(
        staffApi.locations.$get({
          query: parentId ? { parentId, limit: "200" } : { locality: "GOVERNORATE", limit: "200" },
        }),
      ),
  });
  // The governorates come in as a list of rows in gray; a place opening shows one under it.
  if (children.isPending) {
    return (
      <>
        {Array.from({ length: depth === 0 ? 8 : 1 }, (_, row) => (
          <li
            key={row}
            aria-hidden
            className="flex h-9 items-center px-2"
            style={{ paddingInlineStart: `${String(depth * 1.25 + 0.5)}rem` }}
          >
            <Skeleton className={row % 3 ? "h-3.5 w-28" : "h-3.5 w-36"} />
          </li>
        ))}
      </>
    );
  }
  if (children.isError)
    return <li className="px-2 py-1.5 text-xs text-danger">{t("loadFailed")}</li>;
  if (children.data.data.length === 0 && depth > 0) {
    return (
      <li
        className="py-1.5 text-xs text-muted"
        style={{ paddingInlineStart: `${String(depth * 1.25 + 2)}rem` }}
      >
        {t("noChildren")}
      </li>
    );
  }
  return children.data.data.map((location) => (
    <Node
      key={location.id}
      location={location}
      depth={depth}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  ));
}

function Node({
  location,
  depth,
  selectedId,
  onSelect,
}: TreeProps & { location: Location; depth: number }) {
  const t = useTranslations("staff.locations");
  const name = useLocalName();
  const [open, setOpen] = useState(false);
  const leaf = location.locality === "AREA";
  const selected = location.id === selectedId;

  return (
    <li role="treeitem" aria-expanded={leaf ? undefined : open} aria-selected={selected}>
      <div
        className={cn(
          "flex h-9 items-center gap-1 rounded-lg pe-2 text-sm transition-colors duration-200",
          selected
            ? "bg-primary-soft font-medium text-primary"
            : "text-foreground hover:bg-hover",
        )}
        style={{ paddingInlineStart: `${String(depth * 1.25)}rem` }}
      >
        {leaf ? (
          <span className="size-7 shrink-0" />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? t("collapse") : t("expand")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:text-foreground"
          >
            {open ? (
              <IconChevronDown aria-hidden className="size-4" stroke={1.75} />
            ) : (
              <DirectionalIcon icon={IconChevronRight} className="size-4" stroke={1.75} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelect(location)}
          className="min-w-0 flex-1 truncate text-start"
        >
          {name(location)}
        </button>
        <span className="shrink-0 text-xs font-normal text-muted">
          {t(`localities.${location.locality}`)}
        </span>
      </div>
      {open && !leaf && (
        <ul role="group">
          <Branch
            parentId={location.id}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </ul>
      )}
    </li>
  );
}
