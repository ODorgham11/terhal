"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IconPlus } from "@tabler/icons-react";
import type { Office } from "@terhal/contracts";
import { RequireStaff } from "@/components/session/RequireSession";
import { ListPagination, useCursorList } from "@/components/staff/CursorList";
import { SearchBox } from "@/components/staff/SearchBox";
import { OfficeDrawer } from "@/components/staff/fleet/OfficeDrawer";
import { displayPhone } from "@/components/staff/fleet/format";
import { useLocalName } from "@/components/staff/trips/format";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from "@/components/ui/Table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { call, staffApi, useErrorMessage } from "@/lib/api";

const COLUMNS = 4;
type Flag = "true" | "false";

export function OfficesList() {
  return <RequireStaff permission="fleet">{() => <Offices />}</RequireStaff>;
}

function Offices() {
  const t = useTranslations("staff.fleet.offices");
  const list = useTranslations("staff.list");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const offices = useCursorList(
    ["staff", "offices", "list"],
    { archived: "false" as Flag, q: "" },
    (query) => call(staffApi.offices.$get({ query })),
  );
  const { filters, setFilter, rows, result } = offices;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button onClick={() => setAdding(true)}>
            <IconPlus aria-hidden className="size-5" stroke={1.75} />
            {t("add")}
          </Button>
        }
      />
      <Tabs
        value={filters.archived}
        onValueChange={(value) => setFilter("archived", value as Flag)}
      >
        <TabsList>
          <TabsTrigger value="false">{list("active")}</TabsTrigger>
          <TabsTrigger value="true">{list("archived")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <SearchBox
        initial={filters.q}
        onSearch={(q) => setFilter("q", q)}
        placeholder={t("search")}
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.office")}</TableHead>
            <TableHead>{t("columns.contact")}</TableHead>
            <TableHead>{t("columns.area")}</TableHead>
            <TableHead>{t("columns.address")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.isPending ? (
            <TableLoading columns={COLUMNS} />
          ) : result.isError ? (
            <TableEmpty columns={COLUMNS} title={errorMessage(result.error)} />
          ) : rows.length === 0 ? (
            <TableEmpty columns={COLUMNS} title={t("empty")} description={t("emptyHint")} />
          ) : (
            rows.map((office) => (
              <OfficeRow
                key={office.id}
                office={office}
                onOpen={() => router.push(`/offices/${office.id}`)}
              />
            ))
          )}
        </TableBody>
      </Table>
      <ListPagination list={offices} />
      <OfficeDrawer
        open={adding}
        onOpenChange={setAdding}
        onSaved={(office) => router.push(`/offices/${office.id}`)}
      />
    </>
  );
}

function OfficeRow({ office, onOpen }: { office: Office; onOpen: () => void }) {
  const name = useLocalName();
  return (
    <TableRow className="cursor-pointer hover:bg-surface-muted/50" onClick={onOpen}>
      <TableCell>
        <Link
          href={`/offices/${office.id}`}
          onClick={(event) => event.stopPropagation()}
          className="text-sm font-medium text-foreground hover:underline"
        >
          {office.name}
        </Link>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm text-foreground">{office.contact}</span>
          <span className="text-xs text-muted" dir="ltr">
            {displayPhone(office.phone)}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-sm">{office.location ? name(office.location) : "—"}</TableCell>
      <TableCell className="max-w-72 truncate text-sm text-muted">{office.address}</TableCell>
    </TableRow>
  );
}
