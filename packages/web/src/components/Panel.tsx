import type { ReactNode } from "react";
import type { TablePaginationConfig } from "../types.js";
import { Table } from "./Table.js";

export function Panel({
  title,
  rows,
  headerExtra,
  preferredKeys,
  maxColumns,
  pagination
}: {
  title: string;
  rows: unknown[];
  headerExtra?: ReactNode;
  preferredKeys?: string[];
  maxColumns?: number;
  pagination?: TablePaginationConfig;
}) {
  return (
    <>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{rows.length} rows</span>
        {headerExtra ?? null}
      </div>
      <Table rows={rows} preferredKeys={preferredKeys} maxColumns={maxColumns} pagination={pagination} />
    </>
  );
}
